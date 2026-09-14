"""python3 -m unittest capture.tests.test_demo_storyboard

The flow a demo replays (docs/demos.md, generator stage 3): the storyboard file in JSON and in
the YAML subset, the rules a person can break and the sentence each gets, `${NAME}` read from the
environment and never written back, the default a first run writes, and what each driver is
handed: Maestro flows for the taps, VHS tapes for a terminal.
"""

from __future__ import annotations

import json
import pathlib
import tempfile
import unittest

from capture.demo import ios, storyboard, terminal
from capture.demo import simulator as sim

YAML = """\
# a hand written storyboard
version: 1
kind: expo_ios
app:
  configuration: Debug
  build_env:
    API_URL: "http://127.0.0.1:8787"
device:
  appearance: dark
  location: [33.7695606, -84.3909922]   # North Avenue East
  grant:
    - location
setup:
  - open: "demo://sign-in?token=${BUILDER_DEMO_TOKEN}"
  - wait: 2
beats:
  - label: the map, buses moving
    caption: Every bus on campus
    actions:
      - wait: 1.5
    hold: 2
  - label: building search
    actions:
      - tap: Enter destination
      - type: Clough
      - swipe: up
  - label: 'the results, it''s fast'
    still: false
    actions:
      - tap:
          text: Open directions
          optional: true
stills:
  - label: the settings page
    actions:
      - open: demo://settings
"""


class Parse(unittest.TestCase):
    def test_the_yaml_subset_reads_a_hand_written_storyboard(self):
        data = storyboard.parse_yaml(YAML)
        sb = storyboard.validate(data)
        self.assertEqual(sb["kind"], "expo_ios")
        self.assertEqual(sb["device"]["location"], [33.7695606, -84.3909922])
        self.assertEqual(sb["device"]["grant"], ["location"])
        self.assertEqual(sb["app"]["build_env"], {"API_URL": "http://127.0.0.1:8787"})
        self.assertEqual([b["label"] for b in sb["beats"]], ["the map, buses moving", "building search", "the results, it's fast"])
        self.assertEqual(sb["beats"][1]["actions"], [{"tap": "Enter destination"}, {"type": "Clough"}, {"swipe": "up"}])
        self.assertEqual(sb["beats"][2]["actions"], [{"tap": {"text": "Open directions", "optional": True}}])
        self.assertFalse(sb["beats"][2]["still"])
        self.assertEqual(sb["beats"][0]["hold"], 2.0)
        # No caption written: the label says what the screen shows, so it is the caption.
        self.assertEqual(sb["beats"][1]["caption"], "Building search")

    def test_json_and_yaml_are_the_same_storyboard(self):
        with tempfile.TemporaryDirectory() as t:
            y = pathlib.Path(t) / "storyboard.yaml"
            y.write_text(YAML)
            j = pathlib.Path(t) / "storyboard.json"
            j.write_text(json.dumps(storyboard.parse_yaml(YAML)))
            self.assertEqual(storyboard.load(y), storyboard.load(j))

    def test_yaml_errors_say_where(self):
        with self.assertRaisesRegex(storyboard.StoryboardError, "line 2"):
            storyboard.parse_yaml("a: 1\n\tb: 2\n")
        with self.assertRaisesRegex(storyboard.StoryboardError, "JSON"):
            storyboard.parse_yaml("a: [1, 2\n")


class Rules(unittest.TestCase):
    def base(self, **beat) -> dict:
        b = {"label": "the map", "actions": [{"wait": 1}], **beat}
        return {"version": 1, "kind": "expo_ios", "beats": [b]}

    def refused(self, data, pattern):
        with self.assertRaisesRegex(storyboard.StoryboardError, pattern):
            storyboard.validate(data)

    def test_a_label_is_plain_words(self):
        self.refused(self.base(label="the map \u2014 buses"), "dash")
        self.refused(self.base(label="the map - buses"), "dash")
        # The server's label rule, through the publish side: no hyphen, no slash, no id.
        self.refused(self.base(label="the item/[id] page"), "may not carry")
        self.refused(self.base(label="x" * 81), "characters")
        self.refused(self.base(label=""), "non empty")

    def test_a_caption_is_short(self):
        self.refused(self.base(caption="a caption that goes on far too long for anyone to read in time"), "under 48")

    def test_actions_are_checked(self):
        self.refused(self.base(actions=[{"fly": 1}]), "unknown action")
        self.refused(self.base(actions=[{"wait": 99}]), "between 0 and 60")
        self.refused(self.base(actions=[{"swipe": "sideways"}]), "swipe is one of")
        self.refused(self.base(actions=[{"tap": {"nothing": 1}}]), "tap takes")
        self.refused(self.base(actions=[{"open": "x", "wait": 1}]), "one key")
        # A secret comes in through the environment, and only where a value is used.
        self.refused(self.base(actions=[{"tap": "${TOKEN}"}]), "only in open, type and run")

    def test_a_colour_tap_and_an_expectation(self):
        sb = storyboard.validate(self.base(actions=[{"tap": {"color": "#F6BD0A", "region": [0.78, 0.5, 1, 0.97]}}], expect=r"Walk [0-9.]+ mi"))
        self.assertEqual(sb["beats"][0]["expect"], r"Walk [0-9.]+ mi")
        self.refused(self.base(actions=[{"tap": {"color": "gold"}}]), "RRGGBB")
        self.refused(self.base(actions=[{"tap": {"color": "#F6BD0A", "region": [0.9, 0.5, 0.1, 1]}}]), "left, top, right, bottom")
        self.refused(self.base(expect="(unclosed"), "not a regular expression")
        storyboard.validate(self.base(actions=[{"tap": {"point": "88%, 81%"}}, {"tap": {"point": "350, 700"}}]))
        self.refused(self.base(actions=[{"tap": {"point": "88.5%, 80.7%"}}]), "whole percentages")

    def test_a_beat_can_be_filmed_from_where_it_lands(self):
        self.assertEqual(storyboard.validate(self.base())["beats"][0]["film"], "all")
        self.assertEqual(storyboard.validate(self.base(film="settled"))["beats"][0]["film"], "settled")
        self.refused(self.base(film="some"), "film is")

    def test_an_expectation_that_is_not_on_screen_stops_the_run(self):
        from unittest import mock

        from capture.demo.result import CaptureError

        drv = ios.Driver("UDID", "com.acme.app", pathlib.Path(tempfile.mkdtemp()), [])
        screen = [{"file": "s.png", "lines": [{"text": "Clough"}, {"text": "17 min trip"}]}]
        with mock.patch("capture.demo.privacy.ocr", return_value=screen):
            drv.expect("the results", "min trip", pathlib.Path("s.png"))
            with self.assertRaisesRegex(CaptureError, "expects /Walk"):
                drv.expect("directions", r"Walk [0-9.]+ mi", pathlib.Path("s.png"))

    def test_a_web_page_is_held_to_its_label_like_an_ios_screen(self):
        # FOUND ON THE FIRST WEB DEMO (2026-09-14): the web driver never read `expect`, and a
        # route the server answered 404 on became "the portfolio page".
        from unittest import mock

        from capture.demo import web
        from capture.demo.result import CaptureError

        def c(**kw):
            return {"label": "the portfolio page", "refused": None, "pattern": "(?i)portfolio", "shot": "/w/still-03.png", **kw}

        self.assertEqual(web._verify([c(pattern=None)]), [])
        with self.assertRaisesRegex(CaptureError, "opened /portfolio.html and the server answered 404"):
            web._verify([c(refused=["/portfolio.html", 404])])
        # Read on the PICTURE: text below the fold is not on it.
        shown = [{"file": "/w/still-03.png", "lines": [{"text": "My Portfolio"}]}]
        with mock.patch("capture.demo.privacy.ocr", return_value=shown):
            self.assertEqual(len(web._verify([c()])), 1)
        error_page = [{"file": "/w/still-03.png", "lines": [{"text": "Error response"}, {"text": "File not found"}]}]
        with mock.patch("capture.demo.privacy.ocr", return_value=error_page):
            with self.assertRaisesRegex(CaptureError, "expects /\\(\\?i\\)portfolio/ on the page"):
                web._verify([c()])
        # Vision failing is a failed beat, never a passing one.
        with mock.patch("capture.demo.privacy.ocr", side_effect=RuntimeError("no helper")):
            with self.assertRaisesRegex(CaptureError, "could not be read"):
                web._verify([c()])

    def test_a_still_can_take_its_own_page_size(self):
        # The owner, 2026-09-14: "the projects page should show a list of projects"; on a phone
        # the Personal Website's Projects page is one card a screen, at 820 points two columns.
        wide = {"width": 820, "height": 1783}

        def web(**beat):
            return {**self.base(**beat), "kind": "web"}

        sb = storyboard.validate(web(viewport=wide, video=False))
        self.assertEqual(sb["beats"][0]["viewport"], wide)
        self.assertIsNone(storyboard.validate(web())["beats"][0]["viewport"])
        self.refused(web(viewport=wide), "still only")
        self.refused(web(viewport={"width": 5000, "height": 900}, video=False), "320 to 1600")
        self.refused(web(viewport={"width": 820}, video=False), "whole points")
        self.refused(self.base(viewport=wide, video=False), "only a web page")

    def test_the_shape(self):
        self.refused({"version": 2, "kind": "web", "beats": [{"label": "a"}]}, "version")
        self.refused({"version": 1, "kind": "desktop", "beats": [{"label": "a"}]}, "kind")
        self.refused({"version": 1, "kind": "web", "beats": []}, "at least one beat")
        many = {"version": 1, "kind": "web", "beats": [{"label": f"page {i}"} for i in range(7)]}
        self.refused(many, "stills")
        self.refused({**self.base(), "device": {"location": [1]}}, "latitude, longitude")
        self.refused({**self.base(), "app": {"build_env": {"lower": "x"}}}, "not an environment variable")


class Environment(unittest.TestCase):
    def test_expand_reads_only_the_tools_own_variables(self):
        # A minted token (the tool's own BUILDER_DEMO_ namespace) is read from the environment.
        self.assertEqual(storyboard.expand("a://b?t=${BUILDER_DEMO_TOKEN}", {"BUILDER_DEMO_TOKEN": "tok"}), "a://b?t=tok")
        with self.assertRaisesRegex(storyboard.StoryboardError, "not set"):
            storyboard.expand("a://b?t=${BUILDER_DEMO_TOKEN}", {})

    def test_a_non_tool_variable_is_never_read_from_the_environment(self):
        # The review's item 2: a value from the repository holding ${GITHUB_TOKEN} must not be
        # expanded, even if the variable is set. It is left as the literal text it is.
        self.assertEqual(storyboard.expand("evil://leak?t=${GITHUB_TOKEN}", {"GITHUB_TOKEN": "ghp_secret"}), "evil://leak?t=${GITHUB_TOKEN}")

    def test_a_storyboard_may_not_reference_a_non_tool_variable(self):
        base = {"version": 1, "kind": "web", "beats": [{"label": "one", "actions": [{"open": "/x?t=${GITHUB_TOKEN}"}]}]}
        with self.assertRaisesRegex(storyboard.StoryboardError, "tool's own variables"):
            storyboard.validate(base)

    def test_redact_never_shows_the_value(self):
        self.assertEqual(storyboard.redact("a://b?t=${BUILDER_DEMO_TOKEN}"), "a://b?t=${BUILDER_DEMO_TOKEN}")

    def test_a_repo_scheme_is_validated_before_it_becomes_a_deep_link(self):
        self.assertTrue(storyboard.valid_scheme("widget"))
        self.assertTrue(storyboard.valid_scheme("builder-app"))
        self.assertFalse(storyboard.valid_scheme("evil://x"))
        self.assertFalse(storyboard.valid_scheme("a b"))
        self.assertFalse(storyboard.valid_scheme("${X}"))


class Defaults(unittest.TestCase):
    def test_a_first_storyboard_from_the_routes(self):
        from capture.demo.detect import ExpoApp, Plan

        e = ExpoApp("mobile", "W", "widget", "com.w", "mobile/app.json", False, ["/home", "/stats", "/dev-auth", "/onboarding/hello", "/settings", "/profile", "/more"])
        plan = Plan(project=None, commit="c", kind="expo_ios", kind_reason="", app_dir="mobile", package_manager="bun", expo=e, steps=[], evidence=None, routes=e.routes)
        sb = storyboard.validate(storyboard.default(plan))
        self.assertEqual([b["actions"][0]["open"] for b in sb["beats"]], ["widget://home", "widget://stats", "widget://settings", "widget://profile"])
        self.assertEqual(sb["beats"][0]["label"], "the home screen")
        # The review's item 7: every default beat carries an expect, so a generated storyboard
        # never films a screen it never checked.
        self.assertTrue(all(b["expect"] for b in sb["beats"]))

    def test_an_invalid_repo_scheme_leaves_the_beat_without_a_deep_link(self):
        from capture.demo.detect import ExpoApp, Plan

        # The review's item 2: a scheme read from the repository that is not a valid URL scheme
        # (here it smuggles a variable reference) never becomes an `open`.
        e = ExpoApp("mobile", "W", "evil${GITHUB_TOKEN}", "com.w", "mobile/app.json", False, ["/home"])
        plan = Plan(project=None, commit="c", kind="expo_ios", kind_reason="", app_dir="mobile", package_manager="bun", expo=e, steps=[], evidence=None, routes=e.routes)
        sb = storyboard.validate(storyboard.default(plan))
        self.assertEqual(sb["beats"][0]["actions"], [])  # no open with a bad scheme

    def test_a_static_page_is_named_without_its_extension(self):
        from capture.demo.detect import Plan

        plan = Plan(project=None, commit="c", kind="web", kind_reason="", app_dir="", package_manager=None, expo=None, steps=[], evidence=None, routes=["/", "/recipes.html"])
        labels = [b["label"] for b in storyboard.validate(storyboard.default(plan))["beats"]]
        self.assertEqual(labels, ["the home page", "the recipes page"])


    def test_a_first_storyboard_never_names_a_repository(self):
        # FOUND ON THE FIRST WEB DEMO (2026-09-14): the Personal Website's fourth route is
        # ridegt-fonts.html, another repository's name, and the first run never checked the
        # labels it generated, which travel with the demo as text.
        from capture.demo import privacy
        from capture.demo.detect import Plan, Step

        def named(text):
            return bool(privacy.label_leaks([text], ("personal-website",), ("RideGT",)))

        plan = Plan(project=None, commit="c", kind="web", kind_reason="", app_dir="", package_manager=None, expo=None, steps=[], evidence=None,
                    routes=["/", "/expedia.html", "/ridegt-fonts.html", "/projects.html", "/blog.html"])  # fmt: skip
        labels = [b["label"] for b in storyboard.validate(storyboard.default(plan, named=named))["beats"]]
        self.assertEqual(labels, ["the home page", "the expedia page", "the projects page", "the blog page"])
        cli = Plan(project=None, commit="c", kind="cli", kind_reason="", app_dir="", package_manager=None, expo=None, evidence=None,
                   steps=[Step("run", "tidy --help", "", "x"), Step("run", "tidy ridegt/src", "", "x")])  # fmt: skip
        labels = [b["label"] for b in storyboard.validate(storyboard.default(cli, named=named))["beats"]]
        self.assertEqual(labels, ["what the command can do, its help", "running it"])


class Drivers(unittest.TestCase):
    def test_actions_become_maestro_commands(self):
        self.assertEqual(ios.to_maestro("tap", "Open"), [{"tapOn": "Open"}])
        self.assertEqual(ios.to_maestro("tap", {"text": "Open", "optional": True}), [{"tapOn": {"text": "Open", "optional": True}}])
        self.assertEqual(ios.to_maestro("type", "Clough"), [{"inputText": "Clough"}])
        up = ios.to_maestro("swipe", "up")
        self.assertEqual(up[0]["swipe"]["start"], "50%, 72%")
        self.assertEqual(ios.to_maestro("key", "Enter"), [{"pressKey": "Enter"}])
        self.assertIn("swipe", ios.to_maestro("back", True)[0])

    def test_a_maestro_flow_file(self):
        flow = sim.maestro_flow("com.acme.app", [{"tapOn": {"text": "Open", "optional": True}}, {"inputText": 'say "hi"'}, "back"])
        self.assertEqual(
            flow,
            'appId: com.acme.app\n---\n- tapOn:\n    text: "Open"\n    optional: true\n- inputText: "say \\"hi\\""\n- back\n',
        )
        # What Maestro would read back is what was written.
        parsed = storyboard.parse_yaml(flow.split("---\n", 1)[1])
        self.assertEqual(parsed, [{"tapOn": {"text": "Open", "optional": True}}, {"inputText": 'say "hi"'}, "back"])

    def test_a_vhs_tape_types_the_command_in_the_clone(self):
        tape = terminal.tape(pathlib.Path("/w/src"), 'tidy --check "src"', pathlib.Path("/w/run/beat-01.mp4"), pathlib.Path("/w/run/still-01.png"), 2)
        self.assertIn('Output "/w/run/beat-01.mp4"', tape)
        self.assertIn("Type `tidy --check \"src\"`", tape)
        self.assertIn('Screenshot "/w/run/still-01.png"', tape)
        self.assertIn("Wait\n", tape)
        self.assertIn(f"Set Width {terminal.WIDTH}\nSet Height {terminal.HEIGHT}", tape)
        self.assertGreater(terminal.HEIGHT, terminal.WIDTH)  # portrait, like every other demo

    def test_vhs_cannot_type_all_three_quotes(self):
        from capture.demo.result import CaptureError

        with self.assertRaises(CaptureError):
            terminal.quote("a \" b ` c '")


if __name__ == "__main__":
    unittest.main()
