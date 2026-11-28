import AppKit
import ExecutorCore
import OSLog
import SwiftUI

@main
struct AlphaRadarMac: App {
  var body: some Scene {
    Window("Alpha Radar Mac Executor", id: "executor") {
      Panel()
    }
    .defaultSize(width: 650, height: 640)
    .windowResizability(.contentMinSize)
  }
}

private enum Mode: String, CaseIterable {
  case observe = "OBSERVE"
  case dryRun = "DRY_RUN"
  case assisted = "ASSISTED"
}

private struct Panel: View {
  private static let log = Logger(subsystem: "com.alpha-radar.mac-executor", category: "workflow")
  private static let journal = SimulationJournal(
    directory: URL.applicationSupportDirectory.appending(
      path: "Alpha Radar Mac Executor/Simulation")
  )
  private let workflow = MockWorkflow(journal: Self.journal)

  @AppStorage("cloudOrigin") private var cloudOrigin = ""
  @AppStorage("emergencyStop") private var emergencyStop = false
  @State private var mode: Mode = .dryRun
  @State private var pairingDigest = ""
  @State private var observation: Cloud.Observation?
  @State private var lastAlert: UUID?
  @State private var connection = "未连接"
  @State private var diagnostic = Mirroring.check()
  @State private var lastResult = "尚无结果"
  @State private var latency = ""
  @State private var fixture: Intent?
  @State private var reviewed = false
  @State private var mockMarket: Market = .btc
  @State private var mockHorizon: Horizon = .ten
  @State private var observedMarket: Market = .btc
  @State private var observedHorizon: Horizon = .ten
  @State private var observedDirection: Direction = .higher
  @State private var premium = ""
  @State private var payout = ""
  @State private var drift = "0"
  @State private var outcome: MockOutcome = .success
  @State private var gates = Gates()
  @State private var modal = false
  @State private var preparationStart: Date?
  @State private var generation = UUID()

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        HStack {
          Text("Alpha Radar Mac Executor").font(.title2.bold())
          Spacer()
          Button(emergencyStop ? "解除本地急停" : "Emergency Stop") {
            emergencyStop.toggle()
            reset()
            Self.log.notice("local_stop active=\(emergencyStop)")
          }
          .tint(emergencyStop ? .orange : .red)
          .buttonStyle(.borderedProminent)
        }
        Picker("模式", selection: $mode) {
          ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        .onChange(of: mode) { reset() }
        if emergencyStop { Text("本地已急停").foregroundStyle(.red).bold() }
        HStack {
          LabeledContent("云端", value: mode == .observe ? connection : "离线")
          Divider().frame(height: 15)
          LabeledContent("镜像窗口", value: diagnostic.visible > 0 ? "已检测到" : "未检测到")
        }
        LabeledContent("界面识别", value: "设备状态和订单内容未验证")
        if mode == .observe {
          observePanel
        } else if mode == .dryRun {
          mockPanel
        } else {
          Text("ASSISTED 不可用。等待平台授权及真机订单界面的独立读回验证。")
            .foregroundStyle(.secondary)
        }
        LabeledContent("最近结果", value: lastResult)
        if !latency.isEmpty { Text(latency).font(.caption.monospacedDigit()) }
      }
      .padding(24)
    }
    .frame(minWidth: 570, minHeight: 490)
    .onChange(of: cloudOrigin) {
      if mode == .observe { reset() }
    }
    .task(id: generation) {
      let active = generation
      while !Task.isCancelled {
        diagnostic = Mirroring.check()
        if mode == .observe, !emergencyStop, !cloudOrigin.isEmpty {
          do {
            let value = try await Cloud(origin: cloudOrigin).observe()
            guard active == generation, !Task.isCancelled else { return }
            connection = value.status == .stopped ? "服务器已停止" : "已连接"
            observation = value
            if let intent = value.intent, lastAlert != intent.id {
              lastAlert = intent.id
              let elapsed = Date.now.timeIntervalSince(intent.generatedAt)
              latency = "信号到 Mac  \(Int(elapsed * 1000)) ms"
              Self.log.info("intent_received signal_to_device_ms=\(Int(elapsed * 1000))")
              NSSound.beep()
            }
          } catch {
            guard active == generation, !Task.isCancelled else { return }
            observation = nil
            latency = ""
            connection = "不可用 · 检查配对及连接"
          }
        }
        try? await Task.sleep(for: .seconds(3))
      }
    }
  }

  private var observePanel: some View {
    GroupBox("连接 Alpha Radar") {
      VStack(alignment: .leading, spacing: 10) {
        TextField("https://", text: $cloudOrigin)
        HStack {
          Button("生成设备配对指纹") {
            do {
              let digest = try Cloud(origin: cloudOrigin).fingerprint()
              reset()
              pairingDigest = digest
              lastResult = "设备凭据已保存到本机钥匙串"
            } catch { lastResult = "配对失败 · 检查网址和钥匙串" }
          }
          Button("移除本机凭据") {
            do {
              try Cloud(origin: cloudOrigin).forget()
              reset()
              lastResult = "本机凭据已移除"
            } catch { lastResult = "钥匙串操作失败" }
          }
        }
        if !pairingDigest.isEmpty {
          Text(pairingDigest).font(.caption.monospaced()).textSelection(.enabled)
        }
        TimelineView(.periodic(from: .now, by: 1)) { context in
          if let intent = observation?.intent, intent.executionDeadline > context.date {
            intentLabel(intent, now: context.date)
          } else {
            Text("当前没有可审阅意图").foregroundStyle(.secondary)
          }
        }
      }
      .padding(8)
    }
  }

  private var mockPanel: some View {
    GroupBox("SIMULATION ONLY") {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          marketPicker("模拟市场", selection: $mockMarket)
          horizonPicker("模拟期限", selection: $mockHorizon)
          Button("加载模拟意图", action: loadMock).disabled(emergencyStop)
        }
        if let fixture {
          TimelineView(.periodic(from: .now, by: 1)) { intentLabel(fixture, now: $0.date) }
          Divider()
          HStack {
            marketPicker("界面市场", selection: $observedMarket)
            horizonPicker("界面期限", selection: $observedHorizon)
            Picker("界面方向", selection: $observedDirection) {
              ForEach(Direction.allCases, id: \.self) { Text($0.rawValue.uppercased()).tag($0) }
            }
          }
          HStack {
            TextField("界面保费", text: $premium)
            TextField("界面赔付倍数", text: $payout)
            TextField("漂移 (ATR)", text: $drift)
          }
          HStack {
            Toggle("异常弹窗", isOn: $modal)
            Toggle("模拟断线", isOn: Binding(get: { !gates.connected }, set: { gates.connected = !$0 }))
            Toggle("服务器停机", isOn: $gates.serverStop)
            Toggle(
              "信号过期",
              isOn: Binding(get: { !gates.signalCurrent }, set: { gates.signalCurrent = !$0 }))
          }
          HStack {
            Picker("结果", selection: $outcome) {
              ForEach(MockOutcome.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            Button("核验模拟参数") { runMock(fixture, confirm: false) }
            Button("确认模拟", role: .none) { runMock(fixture, confirm: true) }
              .disabled(!reviewed || emergencyStop)
          }
        }
      }
      .padding(8)
    }
  }

  private func intentLabel(_ intent: Intent, now: Date) -> some View {
    let remaining = max(0, Int(intent.executionDeadline.timeIntervalSince(now)))
    return VStack(alignment: .leading, spacing: 4) {
      Text(
        "\(intent.symbol.rawValue) · \(intent.horizonMinutes.rawValue)m · \(intent.direction.rawValue.uppercased())"
      )
      .font(.headline)
      Text(
        "保费 \(intent.suggestedStake) · 最低赔付 \(intent.minimumPayout)× · 评分 \(intent.signalScore) · 剩余 \(remaining) 秒"
      )
      .monospacedDigit()
    }
  }

  private func marketPicker(_ label: String, selection: Binding<Market>) -> some View {
    Picker(label, selection: selection) {
      ForEach(Market.allCases, id: \.self) { Text($0.rawValue).tag($0) }
    }
  }

  private func horizonPicker(_ label: String, selection: Binding<Horizon>) -> some View {
    Picker(label, selection: selection) {
      ForEach(Horizon.allCases, id: \.self) { Text("\($0.rawValue)m").tag($0) }
    }
  }

  private func reset() {
    generation = UUID()
    observation = nil
    pairingDigest = ""
    connection = "未连接"
    reviewed = false
    fixture = nil
    latency = ""
  }

  private func loadMock() {
    guard let intent = try? Intent.simulation(market: mockMarket, horizon: mockHorizon) else {
      lastResult = "无法创建模拟意图"
      return
    }
    fixture = intent
    reviewed = false
    observedMarket = intent.symbol
    observedHorizon = intent.horizonMinutes
    observedDirection = intent.direction
    premium = intent.suggestedStake
    payout = intent.minimumPayout
    drift = "0"
    gates = Gates()
    modal = false
    preparationStart = .now
    latency = ""
    lastResult = "模拟意图已加载"
  }

  private func runMock(_ intent: Intent, confirm: Bool) {
    var observed = Review(intent: intent)
    observed.symbol = observedMarket
    observed.horizon = observedHorizon
    observed.direction = observedDirection
    observed.premium = premium
    observed.payout = payout
    observed.referenceDriftATR = drift
    observed.screen = modal ? .unexpectedModal : .review
    var activeGates = gates
    activeGates.localStop = emergencyStop
    do {
      if confirm {
        let result = try workflow.confirmSimulation(
          intent: intent, observed: observed, gates: activeGates, now: .now, outcome: outcome
        )
        lastResult = result.rawValue
        reviewed = false
        Self.log.info("simulation_result status=\(result.rawValue, privacy: .public)")
      } else {
        try workflow.review(intent: intent, observed: observed, gates: activeGates, now: .now)
        reviewed = true
        lastResult = "模拟参数核验通过 · 等待模拟确认"
        if let preparationStart {
          let elapsed = Int(Date.now.timeIntervalSince(preparationStart) * 1000)
          latency = "模拟准备（含人工操作） \(elapsed) ms"
        }
        NSSound.beep()
      }
    } catch {
      reviewed = false
      let code = (error as? Stop)?.rawValue ?? "unknown"
      lastResult = "已停止 · \(code)"
      Self.log.notice("simulation_stopped reason=\(code, privacy: .public)")
    }
  }
}
