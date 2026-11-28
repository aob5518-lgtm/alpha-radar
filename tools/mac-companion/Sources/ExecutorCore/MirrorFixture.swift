import Foundation

/// A bounded interpretation of the test page's OCR output. Raw text and images stay in memory.
public struct MirrorFixture: Sendable {
  public enum State: Sendable { case unknown, ready, passed }

  public struct Line: Sendable {
    let text: String
    let confidence: Float
    let bounds: CGRect

    public init(text: String, confidence: Float, bounds: CGRect) {
      self.text = text
      self.confidence = confidence
      self.bounds = bounds
    }
  }

  public let state: State
  public let button: CGRect?

  public init(_ lines: [Line]) {
    func matches(_ text: String) -> [Line] { lines.filter { $0.text.uppercased() == text } }

    func locate(_ text: String) -> CGRect? {
      let readings = matches(text)
      guard readings.count == 1, let line = readings.first, line.confidence >= 0.75,
        line.bounds.width > 0, line.bounds.height > 0,
        CGRect(x: 0, y: 0, width: 1, height: 1).contains(line.bounds)
      else { return nil }
      return line.bounds
    }

    let title = locate("ALPHA RADAR MIRROR TEST")
    let start = locate("TAP TEST BUTTON")
    let passed = locate("IPHONE INPUT RECEIVED")
    if let title, let start, matches("IPHONE INPUT RECEIVED").isEmpty, title.minY > start.maxY,
      (0.25...0.75).contains(start.midX), (0.20...0.70).contains(start.midY)
    {
      state = .ready
      button = start
    } else if let title, let passed, matches("TAP TEST BUTTON").isEmpty, title.minY > passed.maxY {
      state = .passed
      button = nil
    } else {
      state = .unknown
      button = nil
    }
  }
}
