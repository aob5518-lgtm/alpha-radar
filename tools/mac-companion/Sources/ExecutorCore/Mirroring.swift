import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit
import Vision

public struct Mirroring {
  static let bundleID = "com.apple.ScreenContinuity"
  let running: Bool
  public let visible: Int
  public let accessibility: Bool
  public let capturePermission: Bool

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

public enum MirrorTestError: String, Error {
  case unavailable, ambiguousWindow, notForeground, missingCapturePermission
  case missingInputPermission, captureFailed, unexpectedScreen, staleFrame
  case targetChanged, targetObscured, targetGeometryMismatch, inputUnavailable, readbackUnconfirmed
}

public struct MirrorTestResult: Sendable {
  public let activationMs: Int
  public let before: Date
  public let after: Date
  public let inputToReadbackMs: Int
}

/// This driver accepts one local, non-financial action. An `Intent` is never an input here.
@MainActor
public struct NativeMirroring {
  private nonisolated static let clock = ContinuousClock()

  public static func activate() async throws -> Int {
    let start = clock.now
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: Mirroring.bundleID)
    guard apps.count == 1, let app = apps.first, Mirroring.check().visible == 1 else {
      throw MirrorTestError.unavailable
    }
    if !app.isActive {
      NSApp.yieldActivation(to: app)
      if !app.activate(), let url = app.bundleURL {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        configuration.promptsUserIfNeeded = false
        configuration.allowsRunningApplicationSubstitution = false
        let opened = try await NSWorkspace.shared.openApplication(
          at: url, configuration: configuration)
        guard opened.processIdentifier == app.processIdentifier else {
          throw MirrorTestError.targetChanged
        }
      }
    }
    while !foreground(app.processIdentifier) {
      try Task.checkCancellation()
      guard start.duration(to: clock.now) < .seconds(1) else {
        throw MirrorTestError.notForeground
      }
      try await Task.sleep(for: .milliseconds(50))
    }
    return milliseconds(start.duration(to: clock.now))
  }

  public static func testFixture(active: @MainActor () -> Bool) async throws -> MirrorTestResult {
    try requireInput(active: active)
    let activation = try await activate()
    let before = try await capture()
    guard before.fixture.state == .ready, let target = before.fixture.button else {
      throw MirrorTestError.unexpectedScreen
    }
    let fresh = try await capture()
    guard fresh.id == before.id, fresh.pid == before.pid, fresh.frame == before.frame,
      fresh.fixture.state == .ready, let currentTarget = fresh.fixture.button,
      target.contains(CGPoint(x: currentTarget.midX, y: currentTarget.midY))
    else { throw MirrorTestError.targetChanged }

    try requireInput(active: active)
    try requireFresh(fresh)
    let point = CGPoint(
      x: fresh.frame.minX + fresh.frame.width * currentTarget.midX,
      y: fresh.frame.minY + fresh.frame.height * (1 - currentTarget.midY)
    )
    try validateClick(point, in: fresh)
    let inputTime = clock.now
    try click(point)

    // Observe only. A delayed or missing acknowledgement never triggers another click.
    while inputTime.duration(to: clock.now) < .seconds(3) {
      try await Task.sleep(for: .milliseconds(180))
      try requireInput(active: active)
      let after = try await capture()
      try requireFresh(after)
      guard after.id == before.id, after.pid == before.pid, after.frame == before.frame else {
        throw MirrorTestError.targetChanged
      }
      switch after.fixture.state {
      case .passed:
        return MirrorTestResult(
          activationMs: activation, before: fresh.date, after: after.date,
          inputToReadbackMs: milliseconds(inputTime.duration(to: clock.now))
        )
      case .ready: continue
      case .unknown: throw MirrorTestError.unexpectedScreen
      }
    }
    throw MirrorTestError.readbackUnconfirmed
  }

  public static func inspectFixture() async throws -> MirrorFixture.State {
    _ = try await activate()
    let frame = try await capture()
    try requireFresh(frame)
    return frame.fixture.state
  }

  private struct Frame: Sendable {
    let id: CGWindowID
    let pid: pid_t
    let frame: CGRect
    let captured: ContinuousClock.Instant
    let date: Date
    let fixture: MirrorFixture
  }

  // Keep ScreenCaptureKit objects on one side of the actor boundary. The macOS 15 SDK
  // does not mark SCShareableContent as Sendable.
  private nonisolated static func capture() async throws -> Frame {
    guard CGPreflightScreenCaptureAccess() else { throw MirrorTestError.missingCapturePermission }
    let content = try await SCShareableContent.excludingDesktopWindows(
      true, onScreenWindowsOnly: true)
    let windows = content.windows.filter {
      $0.owningApplication?.bundleIdentifier == Mirroring.bundleID && $0.windowLayer == 0
    }
    guard !windows.isEmpty else { throw MirrorTestError.unavailable }
    guard windows.count == 1, let window = windows.first, let app = window.owningApplication else {
      throw MirrorTestError.ambiguousWindow
    }
    let pid = app.processID
    guard await foreground(pid) else { throw MirrorTestError.notForeground }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let options = SCStreamConfiguration()
    options.ignoreShadowsSingleWindow = true
    options.showsCursor = false
    let frame = window.frame
    guard frame.width > 0, frame.height > 0, frame.width <= 2_000, frame.height <= 2_000 else {
      throw MirrorTestError.captureFailed
    }
    options.width = Int((frame.width * 2).rounded())
    options.height = Int((frame.height * 2).rounded())
    let captured = clock.now
    let date = Date.now
    let image = try await SCScreenshotManager.captureImage(
      contentFilter: filter, configuration: options)
    let fixture = try await read(image)
    try Task.checkCancellation()
    guard await foreground(pid) else { throw MirrorTestError.notForeground }
    return Frame(
      id: window.windowID, pid: pid, frame: frame, captured: captured, date: date, fixture: fixture)
  }

  private nonisolated static func read(_ image: CGImage) async throws -> MirrorFixture {
    // Keep Vision off the UI actor so a local stop can invalidate a pending frame.
    try await Task.detached(priority: .userInitiated) {
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["en-US"]
      request.usesLanguageCorrection = false
      try VNImageRequestHandler(cgImage: image).perform([request])
      let readings =
        request.results?.compactMap { line -> MirrorFixture.Line? in
          guard let best = line.topCandidates(1).first else { return nil }
          return .init(text: best.string, confidence: best.confidence, bounds: line.boundingBox)
        } ?? []
      return MirrorFixture(readings)
    }.value
  }

  private static func requireInput(active: @MainActor () -> Bool) throws {
    try Task.checkCancellation()
    guard active() else { throw CancellationError() }
    guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
      throw MirrorTestError.missingInputPermission
    }
  }

  private static func requireFresh(_ frame: Frame) throws {
    guard frame.captured.duration(to: clock.now) < .seconds(1) else {
      throw MirrorTestError.staleFrame
    }
  }

  private static func validateClick(_ point: CGPoint, in frame: Frame) throws {
    guard foreground(frame.pid) else { throw MirrorTestError.notForeground }
    // Core Graphics counts click-through overlays in z-order. Ask AppKit which window
    // would receive mouse-down, using the primary screen to convert Quartz coordinates.
    guard let primary = NSScreen.screens.first else { throw MirrorTestError.inputUnavailable }
    let appKitPoint = NSPoint(x: point.x, y: primary.frame.maxY - point.y)
    guard NSWindow.windowNumber(at: appKitPoint, belowWindowWithWindowNumber: 0) == Int(frame.id)
    else { throw MirrorTestError.targetObscured }

    guard
      let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]],
      let target = windows.first(where: { $0[kCGWindowNumber as String] as? CGWindowID == frame.id }
      ),
      target[kCGWindowOwnerPID as String] as? pid_t == frame.pid,
      (target[kCGWindowAlpha as String] as? Double ?? 0) > 0
    else { throw MirrorTestError.targetChanged }
    guard let raw = target[kCGWindowBounds as String] as? [String: Any],
      let bounds = CGRect(dictionaryRepresentation: raw as CFDictionary),
      bounds == frame.frame, bounds.contains(point)
    else { throw MirrorTestError.targetGeometryMismatch }
  }

  private static func foreground(_ pid: pid_t) -> Bool {
    let front = NSWorkspace.shared.frontmostApplication
    return front?.processIdentifier == pid && front?.bundleIdentifier == Mirroring.bundleID
  }

  private static func click(_ point: CGPoint) throws {
    guard
      let down = CGEvent(
        mouseEventSource: nil, mouseType: .leftMouseDown,
        mouseCursorPosition: point, mouseButton: .left),
      let up = CGEvent(
        mouseEventSource: nil, mouseType: .leftMouseUp,
        mouseCursorPosition: point, mouseButton: .left)
    else { throw MirrorTestError.inputUnavailable }
    // Let WindowServer route the test click to the verified hit window.
    down.setIntegerValueField(.mouseEventClickState, value: 1)
    up.setIntegerValueField(.mouseEventClickState, value: 1)
    down.post(tap: .cgSessionEventTap)
    up.post(tap: .cgSessionEventTap)
  }

  private static func milliseconds(_ value: Duration) -> Int {
    Int(value.components.seconds) * 1_000
      + Int(value.components.attoseconds / 1_000_000_000_000_000)
  }
}
