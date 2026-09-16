Pod::Spec.new do |s|
  s.name           = 'BuilderDrops'
  s.version        = '1.0.0'
  s.summary        = 'The share extension inbox for Builda drops'
  s.description    = 'Reads and clears the App Group queue the share extension writes links into.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # Equal to the app's deployment target (SDK 53 = 15.1), like BuilderLive.
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift}"
end
