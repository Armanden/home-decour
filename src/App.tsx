import React from "react";
import ImageEditor from "./components/ImageEditor";

export default function App() {
  return (
    <div className="app">
      <header>
        <h1>Room Recolor Prototype</h1>
        <p>Upload a photo, draw a polygon region, extract colors, and recolor.</p>
      </header>
      <main>
        <ImageEditor />
      </main>
      <footer>
        <small>Prototype — extend with ML segmentation and LAB recolor for production.</small>
      </footer>
    </div>
  );
}