import CryptoKit
import ExecutorCore
import Foundation
import Security

enum CloudError: Error {
  case invalidOrigin, unpaired, authentication, invalidResponse
  case keychain(OSStatus)
}

struct Cloud: Sendable {
  enum Status: String, Decodable, Sendable {
    case stopped, waiting, review
  }

  struct Observation: Decodable, Sendable {
    let status: Status
    let serverTime: Date
    let intent: Intent?

    private enum CodingKeys: String, CodingKey {
      case status, intent
      case serverTime = "server_time"
    }
  }

  private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
      _ session: URLSession, task: URLSessionTask,
      willPerformHTTPRedirection response: HTTPURLResponse,
      newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
      completionHandler(nil)
    }
  }

  private static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 4
    config.timeoutIntervalForResource = 5
    config.httpShouldSetCookies = false
    config.urlCredentialStorage = nil
    config.urlCache = nil
    return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
  }()

  let origin: URL

  init(origin: String) throws {
    guard let parts = URLComponents(string: origin), parts.scheme == "https",
      let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
      parts.port == nil || parts.port == 443,
      parts.percentEncodedQuery == nil, parts.fragment == nil,
      parts.path.isEmpty || parts.path == "/",
      let normalized = URL(string: "https://\(host.lowercased())")
    else { throw CloudError.invalidOrigin }
    self.origin = normalized
  }

  private var keychainQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.alpha-radar.mac-executor.observe",
      kSecAttrAccount as String: origin.absoluteString,
      kSecAttrSynchronizable as String: false,
    ]
  }

  private func token() throws -> Data? {
    var query = keychainQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &value)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let bytes = value as? Data else {
      throw CloudError.keychain(status)
    }
    return bytes
  }

  func fingerprint() throws -> String {
    if let token = try token() { return Self.hex(SHA256.hash(data: token)) }
    var random = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, random.count, &random)
    guard status == errSecSuccess else { throw CloudError.keychain(status) }
    let token = Data(Self.hex(random).utf8)
    var query = keychainQuery
    query[kSecValueData as String] = token
    let saved = SecItemAdd(query as CFDictionary, nil)
    guard saved == errSecSuccess else { throw CloudError.keychain(saved) }
    return Self.hex(SHA256.hash(data: token))
  }

  func forget() throws {
    let status = SecItemDelete(keychainQuery as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw CloudError.keychain(status)
    }
  }

  private static func hex(_ bytes: some Sequence<UInt8>) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
  }

  func observe() async throws -> Observation {
    guard let bytes = try token(), let token = String(data: bytes, encoding: .utf8) else {
      throw CloudError.unpaired
    }
    var request = URLRequest(
      url: origin.appending(path: "/api/v1/event-semi-auto/mac-executor/observation")
    )
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let (body, response) = try await Self.session.bytes(for: request)
    guard let response = response as? HTTPURLResponse else { throw CloudError.invalidResponse }
    if [401, 404].contains(response.statusCode) { throw CloudError.authentication }
    guard response.statusCode == 200, response.mimeType == "application/json" else {
      throw CloudError.invalidResponse
    }
    var data = Data()
    for try await byte in body {
      guard data.count < 16_384 else { throw CloudError.invalidResponse }
      data.append(byte)
    }
    let poll = try Intent.decoder().decode(Observation.self, from: data)
    let now = Date.now
    guard abs(now.timeIntervalSince(poll.serverTime)) <= 10,
      (poll.status == .review) == (poll.intent != nil)
    else { throw CloudError.invalidResponse }
    if let intent = poll.intent { try intent.validate(at: max(now, poll.serverTime)) }
    return poll
  }
}
