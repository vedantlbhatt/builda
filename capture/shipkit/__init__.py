"""The ship kit: everything a builder posts beside a demo, made on the Mac (docs/ship-kit.md).

    frame.py    one recording into the four social formats, the device drawn at its own shape
                (spec/devices.v1.json), checked by measuring the rendered geometry
    kit.py      the kit: the formats, the GIF, framed stills, before and after, App Store sets,
                the changelog and the captions; `python -m capture demo kit`
    copy.py     a caption per platform from the person's own `claude`, every number checked
    queue.py    the demo queue a session's end writes into, and the judge of what shipped
    watch.py    the one worker: queued jobs and the phone's requests, one demo at a time
    publish.py  the kit to the person's account, after it lists every file and they say yes
    tables.py   GENERATED from spec/shipkit.v1.json by scripts/gen_shipkit.py

Standard library only, like the rest of capture.
"""
