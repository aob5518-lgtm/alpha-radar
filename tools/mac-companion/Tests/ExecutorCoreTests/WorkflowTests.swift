import ExecutorCore
import Foundation

private struct Failure: Error, CustomStringConvertible {
  let description: String
}

private func expect(_ ok: Bool, _ location: UInt = #line) throws {
  guard ok else { throw Failure(description: "Assertion failed at line \(location)") }
}

private func expect(throws expected: Stop, _ action: () throws -> Void, _ location: UInt = #line)
  throws
{
  do {
    try action()
  } catch let error as Stop where error == expected {
    return
  }
  throw Failure(description: "Expected \(expected) at line \(location)")
}

@main
private enum Verification {
  static func main() async throws {
    try validatesExactReadback()
    try stopsOnExpiredSignalDeviceOrPermission()
    for market in Market.allCases {
      for horizon in Horizon.allCases {
        try simulatesFixturesOnly(market: market, horizon: horizon)
      }
    }
    for outcome in [MockOutcome.rejected, .timeout, .unknown] {
      try recordsOutcomeAndNeverRetries(outcome: outcome)
    }
    try await atomicClaimAllowsOneOutcomeAcrossExecutors()
    try interruptedClaimRequiresReconciliationAfterRestart()
    print("11 Mac Executor workflow scenarios passed")
  }
}

private struct Fixture {
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  var journal: SimulationJournal { SimulationJournal(directory: directory) }
  var workflow: MockWorkflow { MockWorkflow(journal: journal) }

  func remove() { try? FileManager.default.removeItem(at: directory) }
  func intent() throws -> Intent { try .simulation(at: now, market: .btc, horizon: .ten) }
}

private func validatesExactReadback() throws {
  let f = Fixture()
  let intent = try f.intent()
  var review = Review(intent: intent)
  try f.workflow.review(intent: intent, observed: review, gates: Gates(), now: f.now)
  review.instrument = UUID()
  try expect(throws: Stop.wrongMarket) { try review.validate(intent: intent) }
  review = Review(intent: intent)
  review.symbol = .eth
  try expect(throws: Stop.wrongMarket) { try review.validate(intent: intent) }
  review = Review(intent: intent)
  review.horizon = .thirty
  try expect(throws: Stop.wrongHorizon) { try review.validate(intent: intent) }
  review = Review(intent: intent)
  review.direction = .lower
  try expect(throws: Stop.wrongDirection) { try review.validate(intent: intent) }
  review = Review(intent: intent)
  review.premium = "10.01"
  try expect(throws: Stop.wrongPremium) { try review.validate(intent: intent) }
  review = Review(intent: intent)
  review.payout = "1.79"
  try expect(throws: Stop.inadequatePayout) { try review.validate(intent: intent) }
  review.payout = "1.80x"
  try expect(throws: Stop.inadequatePayout) { try review.validate(intent: intent) }
  review.payout = "1.80"
  review.referenceDriftATR = "0.251"
  try expect(throws: Stop.priceDrift) { try review.validate(intent: intent) }
}

private func stopsOnExpiredSignalDeviceOrPermission() throws {
  let f = Fixture()
  let intent = try f.intent()
  var gates = Gates()
  var review = Review(intent: intent)
  try expect(throws: Stop.expired) {
    try f.workflow.review(
      intent: intent, observed: review, gates: gates, now: intent.executionDeadline)
  }
  gates.signalCurrent = false
  try expect(throws: Stop.staleSignal) {
    try f.workflow.review(intent: intent, observed: review, gates: gates, now: f.now)
  }
  gates = Gates()
  gates.connected = false
  try expect(throws: Stop.disconnected) {
    try f.workflow.review(intent: intent, observed: review, gates: gates, now: f.now)
  }
  gates.serverStop = true
  gates.connected = true
  try expect(throws: Stop.serverStop) {
    try f.workflow.review(intent: intent, observed: review, gates: gates, now: f.now)
  }
  gates.localStop = true
  gates.connected = false
  try expect(throws: Stop.emergencyStop) {
    try f.workflow.review(intent: intent, observed: review, gates: gates, now: f.now)
  }
  review.screen = .unavailable
  try expect(throws: Stop.unsupportedDevice) { try review.validate(intent: intent) }
  review.screen = .unknown
  try expect(throws: Stop.interfaceUnknown) { try review.validate(intent: intent) }
  review.screen = .unexpectedModal
  try expect(throws: Stop.unexpectedModal) { try review.validate(intent: intent) }
  review.screen = .authenticationRequired
  try expect(throws: Stop.unexpectedModal) { try review.validate(intent: intent) }
}

private func simulatesFixturesOnly(market: Market, horizon: Horizon) throws {
  let f = Fixture()
  defer { f.remove() }
  let intent = try Intent.simulation(at: f.now, market: market, horizon: horizon)
  let observed = Review(intent: intent)
  try f.workflow.review(intent: intent, observed: observed, gates: Gates(), now: f.now)
  try expect(f.journal.previous(intent.id) == nil)
  let result = try f.workflow.confirmSimulation(
    intent: intent, observed: observed, gates: Gates(), now: f.now, outcome: .success
  )
  try expect(result == .simulatedSuccess)
  try expect(f.journal.previous(intent.id) == .simulatedSuccess)
}

private func recordsOutcomeAndNeverRetries(outcome: MockOutcome) throws {
  let f = Fixture()
  defer { f.remove() }
  let intent = try f.intent()
  let result = try f.workflow.confirmSimulation(
    intent: intent, observed: Review(intent: intent), gates: Gates(), now: f.now, outcome: outcome
  )
  try expect(result == (outcome == .rejected ? .simulatedRejection : .reconciliationRequired))
  try expect(f.journal.previous(intent.id) == result)
  try expect(throws: Stop.duplicate) {
    _ = try f.workflow.confirmSimulation(
      intent: intent, observed: Review(intent: intent), gates: Gates(), now: f.now,
      outcome: .success
    )
  }
}

private func atomicClaimAllowsOneOutcomeAcrossExecutors() async throws {
  let f = Fixture()
  defer { f.remove() }
  let intent = try f.intent()
  let accepted = await withTaskGroup(of: Bool.self) { group in
    for _ in 0..<12 {
      group.addTask {
        return
          (try? f.workflow.confirmSimulation(
            intent: intent, observed: Review(intent: intent), gates: Gates(), now: f.now,
            outcome: .success
          )) == .simulatedSuccess
      }
    }
    return await group.reduce(0) { $0 + ($1 ? 1 : 0) }
  }
  try expect(accepted == 1)
}

private func interruptedClaimRequiresReconciliationAfterRestart() throws {
  let f = Fixture()
  defer { f.remove() }
  let intent = try f.intent()
  try FileManager.default.createDirectory(
    at: f.directory.appending(path: intent.id.uuidString),
    withIntermediateDirectories: true)
  try expect(f.journal.previous(intent.id) == .reconciliationRequired)
  try expect(throws: Stop.duplicate) {
    _ = try f.workflow.confirmSimulation(
      intent: intent, observed: Review(intent: intent), gates: Gates(), now: f.now,
      outcome: .success
    )
  }
}
