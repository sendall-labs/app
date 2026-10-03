// Drives the real macOS mouse for demo recordings, so the screen recording
// shows the system cursor moving and clicking.
//   mouse pos                 prints "x y" (screen points)
//   mouse glide X Y [ms]      moves smoothly from the current position
//   mouse click X Y           left click at a point
// Needs Accessibility permission for the app that runs it (System Settings,
// Privacy & Security, Accessibility).
import CoreGraphics
import Foundation

func current() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }
func post(_ type: CGEventType, _ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "pos":
  let p = current()
  print("\(Int(p.x)) \(Int(p.y))")
case "glide":
  let to = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
  let ms = args.count > 4 ? Double(args[4])! : 600
  let from = current()
  let steps = max(1, Int(ms / 8))
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    let e = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    post(.mouseMoved, CGPoint(x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e))
    usleep(8000)
  }
case "click":
  let p = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
  post(.mouseMoved, p)
  usleep(30000)
  post(.leftMouseDown, p)
  usleep(70000)
  post(.leftMouseUp, p)
default:
  FileHandle.standardError.write("usage: mouse pos | glide X Y [ms] | click X Y\n".data(using: .utf8)!)
  exit(2)
}
