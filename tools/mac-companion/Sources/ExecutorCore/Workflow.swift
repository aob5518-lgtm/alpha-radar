import Foundation

public enum Market: String, Codable, CaseIterable, Sendable {
  case btc = "BTCUSDT"
  case eth = "ETHUSDT"
}

public enum Horizon: Int, Codable, CaseIterable, Sendable {
  case ten = 10
  case thirty = 30
}

public enum Direction: String, Codable, CaseIterable, Sendable {
  case higher, lower
}

public struct Intent: Decodable, Sendable {
  public let id: UUID
  public let eventSignalId: UUID
  public let signalVersion: String
  public let strategyVersion: String
  public let marketInstrumentId: UUID
  public let symbol: Market
  public let horizonMinutes: Horizon
  public let direction: Direction
  public let signalScore: Int
  public let signalReferencePrice: String
  public let suggestedStake: String
  public let minimumPayout: String
  public let settingsSnapshot: RiskSnapshot
  public let generatedAt: Date
  public let createdAt: Date
  public let executionDeadline: Date

  private enum CodingKeys: String, CodingKey {
    case id, symbol, direction
    case eventSignalId = "event_signal_id"
    case signalVersion = "signal_version"
    case strategyVersion = "strategy_version"
    case marketInstrumentId = "market_instrument_id"
    case horizonMinutes = "horizon_minutes"
    case signalScore = "signal_score"
    case signalReferencePrice = "signal_reference_price"
    case suggestedStake = "suggested_stake"
    case minimumPayout = "minimum_payout"
    case settingsSnapshot = "settings_snapshot"
    case generatedAt = "generated_at"
    case createdAt = "created_at"
    case executionDeadline = "execution_deadline"
  }

  public struct RiskSnapshot: Decodable, Sendable {
    public let markets: [Market]
    public let horizons: [Horizon]
    public let minimumScore: Int
    public let fixedStake: String
    public let maxStake: String
    public let minimumPayout10m: String
    public let minimumPayout30m: String
    public let maxDriftAtr: String

    private enum CodingKeys: String, CodingKey {
      case markets, horizons
      case minimumScore = "minimum_score"
      case fixedStake = "fixed_stake"
      case maxStake = "max_stake"
      case minimumPayout10m = "minimum_payout_10m"
      case minimumPayout30m = "minimum_payout_30m"
      case maxDriftAtr = "max_drift_atr"
    }
  }

  public func validate(at now: Date) throws {
    guard now < executionDeadline else { throw Stop.expired }
    guard
      id != eventSignalId,
      signalVersion == "event-signal-v1",
      strategyVersion == "event-semi-auto-v1",
      generatedAt <= createdAt, createdAt <= now,
      executionDeadline.timeIntervalSince(generatedAt) <= (horizonMinutes == .ten ? 60 : 120),
      settingsSnapshot.markets.contains(symbol), settingsSnapshot.horizons.contains(horizonMinutes),
      (85...100).contains(settingsSnapshot.minimumScore),
      (settingsSnapshot.minimumScore...100).contains(signalScore),
      let price = amount(signalReferencePrice), price > 0,
      let stake = amount(suggestedStake), stake > 0,
      let maxStake = amount(settingsSnapshot.maxStake), stake <= maxStake,
      stake == amount(settingsSnapshot.fixedStake),
      let payout = amount(minimumPayout), payout > 1,
      payout
        == amount(
          horizonMinutes == .ten
            ? settingsSnapshot.minimumPayout10m : settingsSnapshot.minimumPayout30m
        ),
      let drift = amount(settingsSnapshot.maxDriftAtr), drift > 0
    else { throw Stop.invalidIntent }
  }

  public static func decoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let value = try decoder.singleValueContainer().decode(String.self)
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      if let date = formatter.date(from: value) { return date }
      formatter.formatOptions = [.withInternetDateTime]
      guard let date = formatter.date(from: value) else { throw Stop.invalidIntent }
      return date
    }
    return decoder
  }

  public static func simulation(at now: Date = .now, market: Market, horizon: Horizon) throws
    -> Intent
  {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let fixture: [String: Any] = [
      "id": UUID().uuidString, "event_signal_id": UUID().uuidString,
      "signal_version": "event-signal-v1", "strategy_version": "event-semi-auto-v1",
      "market_instrument_id": UUID().uuidString, "symbol": market.rawValue,
      "horizon_minutes": horizon.rawValue, "direction": market == .btc ? "higher" : "lower",
      "signal_score": 95, "signal_reference_price": "100", "suggested_stake": "10",
      "minimum_payout": "1.80",
      "settings_snapshot": [
        "markets": [market.rawValue], "horizons": [horizon.rawValue], "minimum_score": 85,
        "fixed_stake": "10", "max_stake": "25", "minimum_payout_10m": "1.80",
        "minimum_payout_30m": "1.80", "max_drift_atr": "0.25",
      ],
      "generated_at": formatter.string(from: now),
      "created_at": formatter.string(from: now),
      "execution_deadline": formatter.string(from: now.addingTimeInterval(60)),
    ]
    return try decoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: fixture))
  }
}

func amount(_ value: String) -> Decimal? {
  guard value.utf8.count <= 40, value.wholeMatch(of: /[0-9]+(\.[0-9]+)?/) != nil else { return nil }
  return Decimal(string: value, locale: Locale(identifier: "en_US_POSIX"))
}

public enum Stop: String, Error, Codable, Equatable, Sendable {
  case invalidIntent, expired, staleSignal, duplicate, unsupportedDevice, unexpectedModal
  case disconnected, emergencyStop, serverStop, wrongMarket, wrongHorizon, wrongDirection
  case wrongPremium, inadequatePayout, priceDrift, interfaceUnknown, journalUnavailable
}

public enum Screen: Sendable {
  case unavailable, unknown, authenticationRequired, eventContract, review, unexpectedModal
}

public struct Gates: Sendable {
  public var localStop = false
  public var serverStop = false
  public var connected = true
  public var signalCurrent = true

  public init() {}

  func validate() throws {
    if localStop { throw Stop.emergencyStop }
    if !connected { throw Stop.disconnected }
    if serverStop { throw Stop.serverStop }
    if !signalCurrent { throw Stop.staleSignal }
  }
}

public struct Review: Sendable {
  public var screen: Screen
  public var instrument: UUID
  public var symbol: Market
  public var horizon: Horizon
  public var direction: Direction
  public var premium: String
  public var payout: String
  public var referenceDriftATR: String

  public init(intent: Intent) {
    screen = .review
    instrument = intent.marketInstrumentId
    symbol = intent.symbol
    horizon = intent.horizonMinutes
    direction = intent.direction
    premium = intent.suggestedStake
    payout = intent.minimumPayout
    referenceDriftATR = "0"
  }

  public func validate(intent: Intent) throws {
    switch screen {
    case .review: break
    case .unavailable: throw Stop.unsupportedDevice
    case .authenticationRequired, .unexpectedModal: throw Stop.unexpectedModal
    case .unknown, .eventContract: throw Stop.interfaceUnknown
    }
    guard instrument == intent.marketInstrumentId, symbol == intent.symbol else {
      throw Stop.wrongMarket
    }
    guard horizon == intent.horizonMinutes else { throw Stop.wrongHorizon }
    guard direction == intent.direction else { throw Stop.wrongDirection }
    guard let entered = amount(premium), entered == amount(intent.suggestedStake) else {
      throw Stop.wrongPremium
    }
    guard let observed = amount(payout), let floor = amount(intent.minimumPayout), observed >= floor
    else {
      throw Stop.inadequatePayout
    }
    guard let drift = amount(referenceDriftATR),
      let cap = amount(intent.settingsSnapshot.maxDriftAtr), drift <= cap
    else { throw Stop.priceDrift }
  }
}

public enum MockOutcome: String, Codable, CaseIterable, Sendable {
  case success, rejected, timeout, unknown
}

public enum Result: String, Codable, Sendable {
  case simulatedSuccess, simulatedRejection, reconciliationRequired
}

public struct MockWorkflow: Sendable {
  private let journal: SimulationJournal

  public init(journal: SimulationJournal) {
    self.journal = journal
  }

  public func review(
    intent: Intent, observed: Review, gates: Gates, now: Date
  ) throws {
    try gates.validate()
    try intent.validate(at: now)
    try observed.validate(intent: intent)
  }

  public func confirmSimulation(
    intent: Intent, observed: Review, gates: Gates, now: Date, outcome: MockOutcome
  ) throws -> Result {
    try review(intent: intent, observed: observed, gates: gates, now: now)
    try journal.claim(intent.id)
    let result: Result =
      switch outcome {
      case .success: .simulatedSuccess
      case .rejected: .simulatedRejection
      case .timeout, .unknown: .reconciliationRequired
      }
    try journal.finish(intent.id, result: result)
    return result
  }
}
