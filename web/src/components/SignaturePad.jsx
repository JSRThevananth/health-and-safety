import { useEffect, useRef, useState } from 'react'

/**
 * Draw a signature with a finger or a stylus.
 *
 * Pointer events rather than mouse or touch, so a finger on a phone, a stylus on
 * a tablet and a mouse on a desk all take the same path. The canvas is sized to
 * its rendered width times the device pixel ratio, because a canvas left at its
 * CSS size draws a blurred line on every phone made in the last decade.
 */
export default function SignaturePad({ onChange, disabled = false }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ratio = window.devicePixelRatio || 1
    const { width, height } = canvas.getBoundingClientRect()
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)

    const context = canvas.getContext('2d')
    context.scale(ratio, ratio)
    context.lineWidth = 2.2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    // Black ink regardless of theme: the signature is exported and shown on a
    // white email background, where a light stroke would be invisible.
    context.strokeStyle = '#111827'
  }, [])

  const positionOf = (event) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const start = (event) => {
    if (disabled) return
    // Capture, so a stroke that leaves the canvas still ends cleanly.
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    const { x, y } = positionOf(event)
    const context = canvasRef.current.getContext('2d')
    context.beginPath()
    context.moveTo(x, y)
  }

  const move = (event) => {
    if (!drawing.current) return
    // Stops the page scrolling under a finger that is trying to sign.
    event.preventDefault()
    const { x, y } = positionOf(event)
    const context = canvasRef.current.getContext('2d')
    context.lineTo(x, y)
    context.stroke()
    if (!hasInk) setHasInk(true)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    onChange(canvasRef.current.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange('')
  }

  return (
    <div className="sigpad">
      <canvas
        ref={canvasRef}
        className="sigpad__canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        aria-label="Signature area. Draw your signature here."
        role="img"
      />
      <div className="sigpad__foot">
        <span className="muted small">{hasInk ? 'Signed' : 'Sign above with your finger or a stylus'}</span>
        <button type="button" className="linkish" onClick={clear} disabled={disabled || !hasInk}>
          Clear
        </button>
      </div>
    </div>
  )
}
