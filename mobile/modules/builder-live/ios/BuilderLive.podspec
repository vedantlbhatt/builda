Pod::Spec.new do |s|
  s.name           = 'BuilderLive'
  s.version        = '1.0.0'
  s.summary        = 'Live Activity bridge for Builder'
  s.description    = 'Starts, updates and ends Builder Live Activities from JS via ActivityKit.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # Keep equal to the app's deployment target (SDK 53 = 15.1). ActivityKit is 16.1+, so every
  # ActivityKit call is behind #available and the framework is weak-linked (see weak_frameworks).
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.weak_frameworks = 'ActivityKit'
  s.frameworks = 'WidgetKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift}"
end
