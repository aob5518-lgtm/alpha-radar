import Darwin
import Foundation

/// The local simulator records one outcome per fixture. The atomic directory creation
/// elects a single owner across launches. A claim without a result is never re-executed.
public struct SimulationJournal: Sendable {
  private let directory: URL

  public init(directory: URL) {
    self.directory = directory
  }

  private func claimDirectory(_ id: UUID) -> URL {
    directory.appendingPathComponent(id.uuidString, isDirectory: true)
  }

  func claim(_ id: UUID) throws {
    do {
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
      )
    } catch {
      throw Stop.journalUnavailable
    }
    guard mkdir(claimDirectory(id).path, 0o700) == 0 else {
      throw errno == EEXIST ? Stop.duplicate : Stop.journalUnavailable
    }
  }

  func finish(_ id: UUID, result: Result) throws {
    let file = claimDirectory(id).appendingPathComponent("result.json")
    do {
      try JSONEncoder().encode(result).write(to: file, options: .atomic)
    } catch {
      throw Stop.journalUnavailable
    }
  }

  public func previous(_ id: UUID) -> Result? {
    let folder = claimDirectory(id)
    guard FileManager.default.fileExists(atPath: folder.path) else { return nil }
    guard let data = try? Data(contentsOf: folder.appendingPathComponent("result.json")),
      let result = try? JSONDecoder().decode(Result.self, from: data)
    else {
      return .reconciliationRequired
    }
    return result
  }
}
