// Helper OCR per Apple Vision: compilato una volta e riusato.
// Legge solo un JPEG già normalizzato e stampa JSON su stdout.
// Nessun argomento testuale proviene dall'OCR: solo il percorso del file.

import Foundation
import ImageIO
import Vision

let arguments = CommandLine.arguments
guard arguments.count > 1 else {
  FileHandle.standardError.write(Data("uso: vision-ocr <immagine>\n".utf8))
  exit(2)
}

let url = URL(fileURLWithPath: arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  FileHandle.standardError.write(Data("immagine illeggibile\n".utf8))
  exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["it-IT", "en-US"]

let handler = VNImageRequestHandler(cgImage: image, options: [:])
do {
  try handler.perform([request])
} catch {
  FileHandle.standardError.write(Data("vision: \(error.localizedDescription)\n".utf8))
  exit(4)
}

var lines: [[String: Any]] = []
for observation in request.results ?? [] {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { continue }
  lines.append(["text": text, "confidence": Double(candidate.confidence)])
}

let payload: [String: Any] = ["engine": "apple-vision", "lines": lines]
do {
  let data = try JSONSerialization.data(withJSONObject: payload)
  FileHandle.standardOutput.write(data)
} catch {
  FileHandle.standardError.write(Data("json: \(error.localizedDescription)\n".utf8))
  exit(5)
}
