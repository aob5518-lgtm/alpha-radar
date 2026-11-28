import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit

public struct Mirroring {
  static let bundleID = "com.apple.ScreenContinuity"
  let running: Bool
  public let visible: Int
  let accessibility: Bool
  let capturePermission: Bool

  public static func check() -> Self {
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
    let pids = Set(apps.map { Int($0.processIdentifier) })
    let windows =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]] ?? []
    let visible = windows.filter { window in
      pids.contains(window[kCGWindowOwnerPID as String] as? Int ?? -1)
        && window[kCGWindowLayer as String] as? Int == 0
    }.count
    return Self(
      running: !apps.isEmpty, visible: visible, accessibility: AXIsProcessTrusted(),
      capturePermission: CGPreflightScreenCaptureAccess()
    )
  }

  public static func probe() async {
    let state = check()
    print(
      "mirroringRunning=\(state.running) visibleWindows=\(state.visible) "
        + "accessibility=\(state.accessibility) screenCapture=\(state.capturePermission)"
    )
    guard state.capturePermission else { return }
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(
        true, onScreenWindowsOnly: true)
      let count = content.windows.filter { $0.owningApplication?.bundleIdentifier == bundleID }
        .count
      print("screenCaptureKitMirroringWindows=\(count) contentObserved=false")
    } catch {
      print("screenCaptureKitMirroringWindows=unavailable contentObserved=false")
    }
  }
}
