import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./style.css";
import { appWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/tauri";

// DevTools açmak için F12 kısayol tuşu
// Sayfa tamamen yüklendikten sonra güvenli bir şekilde event listener'ı ekle
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM içeriği yüklendi, DevTools listener'ı hazırlanıyor...");

  // React render döngüsünden bağımsız bir şekilde event listener'ı ekle
  setTimeout(() => {
    console.log("DevTools listener'ı aktif edildi");

    document.addEventListener("keydown", async (e) => {
      if (e.key === "F12") {
        try {
          console.log("F12 tuşuna basıldı, DevTools açma/kapama komutu çağrılıyor...");
          // DevTools'u aç
          await invoke("toggle_devtools");
          console.log("DevTools komutu başarıyla çağrıldı");
        } catch (err) {
          console.error("DevTools açılırken hata oluştu:", err);
        }
      }
    });
  }, 1500); // React'ın render döngüsünden sonra çalışması için yeterli gecikme
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
