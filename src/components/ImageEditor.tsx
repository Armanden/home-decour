import React, { useRef, useState, useEffect } from "react";
import { extractDominantColors } from "../utils/kmeans";
import {
  rgbToHsl,
  hslToRgb,
  clamp,
  hexToRgb,
  mix,
} from "../utils/colorUtils";

type Point = { x: number; y: number };

export default function ImageEditor() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const pointsRef = useRef<Point[]>([]); // keep latest points for pointer handlers
  const [closed, setClosed] = useState(false);
  const [swatches, setSwatches] = useState<number[][]>([]);
  const [selectedColor, setSelectedColor] = useState<number[] | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  // New: drag/lasso selection mode
  const [dragSelect, setDragSelect] = useState<boolean>(true);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);

  // New states for custom color & intensity
  const [customHex, setCustomHex] = useState<string>("#ff0000");
  const [customRgb, setCustomRgb] = useState<[number, number, number] | null>(
    hexToRgb("#ff0000")
  );
  const [intensity, setIntensity] = useState<number>(1); // 0..1

  // update customRgb when hex changes
  useEffect(() => {
    const r = hexToRgb(customHex);
    setCustomRgb(r);
  }, [customHex]);

  // reapply when intensity changes
  useEffect(() => {
    if (selectedColor) applyRecolor(selectedColor, intensity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intensity]);

  const loadImageFromFile = (file: File) => {
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setPoints([]);
      pointsRef.current = [];
      setClosed(false);
      setSwatches([]);
      setSelectedColor(null);
      drawToCanvases(img);
    };
    img.src = URL.createObjectURL(file);
  };

  const drawToCanvases = (img: HTMLImageElement) => {
    const c = canvasRef.current!;
    const o = offRef.current!;
    const maxW = 1000;
    const scale = Math.min(1, maxW / img.width);
    const w = Math.floor(img.width * scale);
    const h = Math.floor(img.height * scale);
    // Set both canvas display and buffer size
    c.width = w;
    c.height = h;
    o.width = w;
    o.height = h;
    // Ensure CSS size matches buffer size to keep things simple
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d")!;
    const off = o.getContext("2d")!;
    off.clearRect(0, 0, w, h);
    ctx.clearRect(0, 0, w, h);
    off.drawImage(img, 0, 0, w, h);
    // show original initially
    ctx.drawImage(img, 0, 0, w, h);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadImageFromFile(f);
  };

  // helper: convert client coordinates to canvas pixel coordinates
  const clientToCanvas = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;
    return { x, y };
  };

  // Click-to-add vertex (polygon mode)
  const canvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image || closed || dragSelect) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    const next = [...pointsRef.current, { x, y }];
    pointsRef.current = next;
    setPoints(next);
    drawOverlay(next, false);
  };

  // Lasso/drag handlers
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image || !dragSelect) return;
    // left button only (button === 0)
    if ((e as any).button && (e as any).button !== 0) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    setIsDrawing(true);
    const start: Point = { x, y };
    pointsRef.current = [start];
    setPoints([start]);
    setClosed(false);
    drawOverlay([start], true);
    // capture pointer to keep receiving events
    try {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !image || !dragSelect) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    const prev = pointsRef.current;
    const last = prev[prev.length - 1];
    const dx = last ? x - last.x : 0;
    const dy = last ? y - last.y : 0;
    if (dx * dx + dy * dy < 4) return; // small threshold (2px)
    const next = [...prev, { x, y }];
    pointsRef.current = next;
    setPoints(next);
    drawOverlay(next, true);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image || !dragSelect) return;
    if (isDrawing) {
      setIsDrawing(false);
      const finalPoints = pointsRef.current;
      if (finalPoints.length < 3) {
        // Too few points: reset
        pointsRef.current = [];
        setPoints([]);
        setClosed(false);
        if (image) drawToCanvases(image);
      } else {
        setClosed(true);
        drawOverlay(finalPoints, false);
        // extract colors automatically
        const colors = getColorsFromMask(finalPoints, 3);
        setSwatches(colors);
      }
      // release pointer capture
      try {
        (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const drawOverlay = (pts: Point[], drawingPreview = false) => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    // Redraw base (from offscreen canvas element)
    const off = offRef.current!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(off, 0, 0);
    if (pts.length === 0) return;
    // draw fill if closed or if previewing while drawing (semi-transparent)
    ctx.fillStyle = drawingPreview ? "rgba(255, 255, 0, 0.08)" : "rgba(255, 255, 0, 0.12)";
    ctx.strokeStyle = "rgba(255, 165, 0, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (!drawingPreview) ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // draw path line (for preview while drawing keep it open)
    ctx.strokeStyle = "rgba(255,80,0,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (!drawingPreview) ctx.closePath();
    ctx.stroke();

    // draw small handles
    for (const p of pts) {
      ctx.fillStyle = "rgba(255,80,0,0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const closePolygon = () => {
    const finalPoints = pointsRef.current.length ? pointsRef.current : points;
    if (finalPoints.length < 3) return alert("Need at least 3 points");
    setClosed(true);
    pointsRef.current = finalPoints;
    setPoints(finalPoints);
    drawOverlay(finalPoints, false);
    // extract colors from mask
    const colors = getColorsFromMask(finalPoints, 3);
    setSwatches(colors);
  };

  const getColorsFromMask = (pts: Point[], k = 3) => {
    const off = offRef.current!;
    const ctx = off.getContext("2d")!;
    const { width, height } = off;
    const img = ctx.getImageData(0, 0, width, height);
    // build mask using Path2D and isPointInPath
    const path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    path.closePath();
    const pixels: number[][] = [];
    // iterate scanlines (could be optimized)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((ctx as any).isPointInPath(path, x + 0.5, y + 0.5)) {
          const idx = (y * width + x) * 4;
          pixels.push([img.data[idx], img.data[idx + 1], img.data[idx + 2]]);
        }
      }
    }
    if (pixels.length === 0) return [];
    const clusters = extractDominantColors(pixels, k);
    return clusters;
  };

  // intensity in 0..1
  const applyRecolor = (colorRGB: number[] | null, intensityParam = 1) => {
    if (!closed || !image || !colorRGB) return;
    setSelectedColor(colorRGB);
    const c = canvasRef.current!;
    const off = offRef.current!;
    const ctx = c.getContext("2d")!;
    const offCtx = off.getContext("2d")!;
    const { width, height } = off;
    // get mask path from latest points
    const pts = pointsRef.current.length ? pointsRef.current : points;
    const path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    path.closePath();
    const imgData = offCtx.getImageData(0, 0, width, height);
    // target HSL
    const [tr, tg, tb] = colorRGB;
    const [th, ts] = rgbToHsl(tr, tg, tb);
    // copy original into ctx then modify pixels in mask
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(off, 0, 0);
    const dst = ctx.getImageData(0, 0, width, height);
    const intensity = clamp(intensityParam, 0, 1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((offCtx as any).isPointInPath(path, x + 0.5, y + 0.5)) {
          const idx = (y * width + x) * 4;
          const r = imgData.data[idx];
          const g = imgData.data[idx + 1];
          const b = imgData.data[idx + 2];
          const [h, s, l] = rgbToHsl(r, g, b);
          // Mix original H,S with target H,S according to intensity
          // preserve luminance (l) to keep shading
          const newH = mix(h, th, intensity);
          const newS = clamp(mix(s, ts, intensity), 0, 1);
          const newL = l; // preserve luminance
          const [nr, ng, nb] = hslToRgb(newH, newS, newL);
          dst.data[idx] = nr;
          dst.data[idx + 1] = ng;
          dst.data[idx + 2] = nb;
          // alpha unchanged
        }
      }
    }
    ctx.putImageData(dst, 0, 0);
  };

  const reset = () => {
    if (!image) return;
    pointsRef.current = [];
    setPoints([]);
    setClosed(false);
    setSwatches([]);
    setSelectedColor(null);
    drawToCanvases(image);
  };

  // Handlers for custom color
  const onApplyCustom = () => {
    if (!customRgb) return alert("Invalid color");
    applyRecolor(customRgb, intensity);
  };

  const onHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomHex(e.target.value);
  };

  return (
    <div className="editor">
      <div className="controls">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
        />
        <button
          onClick={() => {
            if (pointsRef.current.length >= 3) closePolygon();
          }}
        >
          Close Polygon
        </button>
        <button onClick={reset}>Reset</button>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showOriginal}
            onChange={(e) => {
              setShowOriginal(e.target.checked);
              const c = canvasRef.current!;
              const ctx = c.getContext("2d")!;
              const off = offRef.current!;
              if (e.target.checked) ctx.drawImage(off, 0, 0);
              else {
                if (selectedColor) applyRecolor(selectedColor, intensity);
                else ctx.drawImage(off, 0, 0);
              }
            }}
          />{" "}
          Show Original
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 12 }}>
          <input
            type="checkbox"
            checked={dragSelect}
            onChange={(e) => {
              // toggle selection mode; reset current points/drawing
              setDragSelect(e.target.checked);
              pointsRef.current = [];
              setPoints([]);
              setClosed(false);
              setSwatches([]);
              setSelectedColor(null);
              if (image) drawToCanvases(image);
            }}
          />{" "}
          Drag Select (Lasso)
        </label>
      </div>

      <div className="canvasWrap">
        <canvas
          ref={canvasRef}
          className="mainCanvas"
          onClick={canvasClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={(e) => {
            // If pointer leaves while drawing, treat as pointer up
            if (isDrawing) onPointerUp(e as any);
          }}
        />
        {/* Offscreen canvas shown for convenience (hidden) */}
        <canvas ref={offRef} style={{ display: "none" }} />
      </div>

      <div className="info">
        <p>
          Select a region either by dragging (Lasso) or by clicking points (Polygon).
          - Drag mode: hold mouse/touch and draw freehand; release to finish.
          - Polygon mode: click vertices then "Close Polygon".
        </p>
        {swatches.length > 0 && (
          <div>
            <h4>Extracted colors</h4>
            <div className="swatches">
              {swatches.map((s, i) => {
                const style = {
                  background: `rgb(${s[0]}, ${s[1]}, ${s[2]})`,
                };
                return (
                  <button
                    key={i}
                    className="swatch"
                    style={style}
                    onClick={() => {
                      applyRecolor(s, intensity);
                    }}
                    title={`Use color rgb(${s[0]},${s[1]},${s[2]})`}
                  />
                );
              })}
            </div>
            <p>Click a swatch to recolor the selected region.</p>
          </div>
        )}

        <hr />

        <h4>Custom color</h4>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="color"
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
            aria-label="Pick color"
          />
          <input
            type="text"
            value={customHex}
            onChange={onHexChange}
            style={{ width: 90 }}
            aria-label="Hex color"
          />
          <button onClick={onApplyCustom}>Apply Custom Color</button>
        </div>

        <div style={{ marginTop: 8 }}>
          <label>
            Intensity: {Math.round(intensity * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(intensity * 100)}
              onChange={(e) => setIntensity(Number(e.target.value) / 100)}
              style={{ width: "100%" }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}