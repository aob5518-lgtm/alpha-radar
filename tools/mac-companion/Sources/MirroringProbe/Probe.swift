import ExecutorCore

@main
enum Probe {
  static func main() async {
    await Mirroring.probe()
  }
}
