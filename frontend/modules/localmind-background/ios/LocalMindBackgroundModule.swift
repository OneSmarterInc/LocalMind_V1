import BackgroundTasks
import ExpoModulesCore
import Foundation

/// Keeps on-device generation running while the person uses other apps.
///
/// iOS 26 and later: a continued-processing task started by the person
/// (pressing generate). iOS shows a system progress bar and lets the work
/// continue in other apps until it finishes, or until iOS ends it (low battery,
/// memory, or the person stops it from the progress bar). Then "onExpired" tells
/// JavaScript to pause the answer, which continues when LocalMind is opened.
///
/// The GPU is requested only when the app declares background GPU access
/// (Info.plist LocalMindBackgroundGPU, set with its entitlement by
/// plugins/withBackgroundGeneration.js) and this iPhone supports it.
///
/// Older iOS, or a build made with an Xcode older than 26: isSupported() is
/// false and generation pauses off screen instead, as before.
public class LocalMindBackgroundModule: Module {
  private let lock = NSLock()
  private var task: AnyObject?
  private var pendingIdentifier: String?
  private var ended = true
  private var fraction = 0.0
  private var subtitle = ""

  public func definition() -> ModuleDefinition {
    Name("LocalMindBackground")
    Events("onExpired")

    Function("isSupported") { () -> Bool in
      return Self.supported()
    }

    Function("gpuInBackground") { () -> Bool in
      return Self.gpuSupported()
    }

    AsyncFunction("begin") { (title: String, subtitle: String) -> Bool in
      return self.begin(title: title, subtitle: subtitle)
    }.runOnQueue(.main)

    Function("update") { (fraction: Double, subtitle: String) in
      self.update(fraction: fraction, subtitle: subtitle)
    }

    Function("end") { (success: Bool) in
      self.end(success: success)
    }
  }

  private static func supported() -> Bool {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) { return true }
    #endif
    return false
  }

  private static func gpuSupported() -> Bool {
    guard Bundle.main.object(forInfoDictionaryKey: "LocalMindBackgroundGPU") as? Bool == true else { return false }
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      return BGTaskScheduler.supportedResources.contains(.gpu)
    }
    #endif
    return false
  }

  private func begin(title: String, subtitle: String) -> Bool {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      end(success: true)
      // Info.plist permits "<bundle id>.generate.*". A fresh identifier per
      // session, because an identifier can be registered only once per launch.
      let identifier = "\(Bundle.main.bundleIdentifier ?? "com.onesmarter.localmind").generate.\(UUID().uuidString)"
      let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { [weak self] launched in
        guard let self, let continued = launched as? BGContinuedProcessingTask else {
          launched.setTaskCompleted(success: false)
          return
        }
        self.attach(continued)
      }
      guard registered else { return false }
      let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: subtitle)
      // Start now or not at all: a queued start after the person has left
      // would be work they did not see begin.
      request.strategy = .fail
      if Self.gpuSupported() { request.requiredResources = .gpu }
      // Open the session before submitting: iOS may start the task (and call
      // attach) before submit returns.
      lock.lock()
      pendingIdentifier = identifier
      ended = false
      self.fraction = 0
      self.subtitle = subtitle
      lock.unlock()
      do {
        try BGTaskScheduler.shared.submit(request)
      } catch {
        lock.lock()
        pendingIdentifier = nil
        ended = true
        lock.unlock()
        return false
      }
      return true
    }
    #endif
    return false
  }

  #if compiler(>=6.2)
  @available(iOS 26.0, *)
  private func attach(_ continued: BGContinuedProcessingTask) {
    lock.lock()
    let alreadyEnded = ended
    if !alreadyEnded {
      task = continued
      pendingIdentifier = nil
    }
    let current = fraction
    lock.unlock()
    if alreadyEnded {
      continued.setTaskCompleted(success: true)
      return
    }
    continued.expirationHandler = { [weak self] in
      guard let self else { return }
      self.lock.lock()
      self.task = nil
      self.ended = true
      self.lock.unlock()
      self.sendEvent("onExpired", [:])
      continued.setTaskCompleted(success: false)
    }
    continued.progress.totalUnitCount = 1000
    continued.progress.completedUnitCount = Int64(current * 1000)
  }
  #endif

  private func update(fraction: Double, subtitle: String) {
    lock.lock()
    self.fraction = max(0, min(1, fraction))
    self.subtitle = subtitle
    let current = task
    let value = self.fraction
    lock.unlock()
    #if compiler(>=6.2)
    if #available(iOS 26.0, *), let continued = current as? BGContinuedProcessingTask {
      continued.progress.completedUnitCount = Int64(value * 1000)
      continued.updateTitle(continued.title, subtitle: subtitle)
    }
    #endif
  }

  private func end(success: Bool) {
    lock.lock()
    let current = task
    let pending = pendingIdentifier
    task = nil
    pendingIdentifier = nil
    ended = true
    lock.unlock()
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      if let continued = current as? BGContinuedProcessingTask {
        continued.progress.completedUnitCount = continued.progress.totalUnitCount
        continued.setTaskCompleted(success: success)
      } else if let pending {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: pending)
      }
    }
    #endif
  }
}
