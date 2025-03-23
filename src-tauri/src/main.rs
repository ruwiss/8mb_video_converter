#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]
use atem::ffmpeg::{
    convert_first, convert_out, get_duration, get_original_audio_rate, get_output, get_target_size,
    get_target_video_rate, is_minsize,
};
use std::env;
use std::fs::{OpenOptions, create_dir_all};
use std::io::Write;
use std::path::Path;
use tauri::{
    api::{dialog::message, process::Command},
    Manager,
};

pub mod ffmpeg;

// Log seviyeleri
#[derive(Debug, Clone, Copy)]
enum LogLevel {
    Info,
    Warning,
    Error,
    Debug,
}

impl LogLevel {
    fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Info => "INFO",
            LogLevel::Warning => "WARN",
            LogLevel::Error => "ERROR",
            LogLevel::Debug => "DEBUG",
        }
    }
}

// Loglama için geliştirilmiş yardımcı fonksiyon
fn log_to_file(message: &str, level: LogLevel, category: &str) {
    // Kullanıcı belgelerine özel log klasörü oluştur
    let mut log_dir = if let Some(user_dirs) = directories::UserDirs::new() {
        // Dökümanlar klasörünü bul, yoksa temp klasörünü kullan
        let mut path = match user_dirs.document_dir() {
            Some(doc_dir) => doc_dir.to_path_buf(),
            None => env::temp_dir(),
        };
        path.push("Max8VideoEditor");
        path.push("logs");
        path
    } else {
        let mut path = env::temp_dir();
        path.push("Max8VideoEditor");
        path.push("logs");
        path
    };

    // Log dizinini oluştur
    if let Err(e) = create_dir_all(&log_dir) {
        eprintln!("Log dizini oluşturulamadı: {}", e);
        return;
    }

    // Son tarihle log dosyası oluştur
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let log_file_name = format!("max8videoeditor_{}.log", today);
    log_dir.push(log_file_name);

    // Konsola da yazdır
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S.%3f").to_string();
    let log_line = format!("[{}] [{}] [{}] {}\n", timestamp, level.as_str(), category, message);

    println!("{}", log_line.trim());

    // Dosyaya yaz
    match OpenOptions::new().create(true).append(true).open(&log_dir) {
        Ok(mut file) => {
            if let Err(e) = file.write_all(log_line.as_bytes()) {
                eprintln!("Log yazma hatası: {}", e);
            }
        }
        Err(e) => {
            eprintln!("Log dosyası açılamadı: {}", e);
        }
    }
}

// Basit log fonksiyonları
fn log_info(message: &str, category: &str) {
    log_to_file(message, LogLevel::Info, category);
}

fn log_error(message: &str, category: &str) {
    log_to_file(message, LogLevel::Error, category);
}

fn log_warning(message: &str, category: &str) {
    log_to_file(message, LogLevel::Warning, category);
}

#[cfg(debug_assertions)]
fn log_debug(message: &str, category: &str) {
    log_to_file(message, LogLevel::Debug, category);
}

#[cfg(not(debug_assertions))]
fn log_debug(_message: &str, _category: &str) {
    // Release modunda log_debug işlemi yapılmayacak
}

// Log çevresinin durumunu yazdıran fonksiyon
fn log_environment() {
    let os_name = env::consts::OS;
    let os_arch = env::consts::ARCH;

    // Çevre değişkenlerini logla
    log_info(&format!("İşletim Sistemi: {}", os_name), "System");
    log_info(&format!("İşlemci Mimarisi: {}", os_arch), "System");

    // Geçici dizin ve logların yazıldığı dizini logla
    let temp_dir = env::temp_dir().to_string_lossy().to_string();
    log_info(&format!("Geçici Dizin: {}", temp_dir), "System");

    if let Some(user_dirs) = directories::UserDirs::new() {
        if let Some(doc_dir) = user_dirs.document_dir() {
            let doc_path = doc_dir.to_string_lossy().to_string();
            log_info(&format!("Belgeler Dizini: {}", doc_path), "System");

            let mut log_path = doc_dir.to_path_buf();
            log_path.push("Max8VideoEditor");
            log_path.push("logs");
            log_info(&format!("Log Dizini: {}", log_path.to_string_lossy()), "System");
        }
    }

    // Build modunu logla
    #[cfg(debug_assertions)]
    log_info("Uygulama modu: DEBUG", "System");

    #[cfg(not(debug_assertions))]
    log_info("Uygulama modu: RELEASE", "System");
}

// JavaScript'ten çağrılabilecek loglama fonksiyonu
#[tauri::command(async)]
fn log_to_file_js(message: &str, level: Option<&str>, category: Option<&str>) {
    let log_level = match level {
        Some("warning") => LogLevel::Warning,
        Some("error") => LogLevel::Error,
        Some("debug") => LogLevel::Debug,
        _ => LogLevel::Info,
    };

    let log_category = category.unwrap_or("JS");
    log_to_file(message, log_level, log_category);
}

// Dosya varlığını kontrol eden ve bunu loglayan fonksiyon
#[tauri::command(async)]
fn check_file_exists(path: &str) -> bool {
    let exists = Path::new(path).exists();
    let message = if exists {
        format!("Dosya mevcut: {}", path)
    } else {
        format!("Dosya bulunamadı: {}", path)
    };

    log_info(&message, "FileCheck");
    exists
}

// Video URL'sini kontrol eden fonksiyon
#[tauri::command(async)]
fn check_video_url(url: &str) -> bool {
    log_info(&format!("Video URL kontrol ediliyor: {}", url), "VideoURL");

    // URL'i parçalara ayır
    if let Some(protocol) = url.split("://").next() {
        log_info(&format!("URL protokolü: {}", protocol), "VideoURL");
    }

    // Dosya protokolüyle başlıyorsa, dosyanın varlığını kontrol et
    if url.starts_with("file://") {
        let path = url.replace("file://", "");
        let exists = Path::new(&path).exists();

        if exists {
            log_info(&format!("Video dosyası mevcut: {}", path), "VideoURL");
        } else {
            log_error(&format!("Video dosyası bulunamadı: {}", path), "VideoURL");
        }

        return exists;
    }

    true
}

#[tauri::command(async)]
fn open_file_explorer(path: &str, window: tauri::Window) {
    let label = window.label();
    let parent_window = window.get_window(label).unwrap();
    println!("{}", path);
    log_info(&format!("Açılacak dosya: {}", path), "FileExplorer");

    match env::consts::OS {
        "windows" => {
            Command::new("explorer")
                .args(["/select,", path]) // The comma after select is not a typo
                .spawn()
                .unwrap();
        }
        "macos" => {
            Command::new("open")
                .args(["-R", path]) // i don't have a mac so not 100% sure
                .spawn()
                .unwrap();
        }
        _ => {
            tauri::async_runtime::spawn(async move {
                message(
                    Some(&parent_window),
                    "Unsupported OS",
                    "Opening a file browser is unsupported on linux",
                );
            });
        }
    }
}

#[tauri::command(async)]
fn convert_video(
    window: tauri::Window,
    input: &str,
    target_size: f32,
    start_time: Option<f32>,
    end_time: Option<f32>,
    crop: Option<serde_json::Value>
) -> String {
    log_info(&format!("Video dönüştürme başlatıldı: {}", input), "Conversion");
    log_info(&format!("Hedef boyut: {} MB", target_size), "Conversion");

    // Zaman aralığı kontrolü
    if let Some(start) = start_time {
        if start > 0.0 {
            log_info(&format!("Başlangıç zamanı: {} saniye", start), "Conversion");
        } else {
            log_info("Başlangıç zamanı belirtilmedi (0 veya null)", "Conversion");
        }
    } else {
        log_info("Başlangıç zamanı parametresi yok (null)", "Conversion");
    }

    if let Some(end) = end_time {
        log_info(&format!("Bitiş zamanı: {} saniye", end), "Conversion");
    } else {
        log_info("Bitiş zamanı parametresi yok (null)", "Conversion");
    }

    // Crop değerlerini log
    if let Some(crop_val) = &crop {
        log_info(&format!("Crop ayarları: {}", crop_val), "Conversion");

        // Crop parametrelerini doğrula
        if let Some(crop_obj) = crop_val.as_object() {
            if let (Some(w), Some(h)) = (
                crop_obj.get("width").and_then(|v| v.as_f64()),
                crop_obj.get("height").and_then(|v| v.as_f64())
            ) {
                if w <= 0.0 || h <= 0.0 || w >= 100.0 || h >= 100.0 {
                    log_warning(&format!("Geçersiz crop boyutları: genişlik={}, yükseklik={}", w, h), "Conversion");
                }
            }
        }
    } else {
        log_info("Crop işlemi yapılmayacak", "Conversion");
    }

    let output = get_output(input);
    log_info(&format!("Çıktı dosyası: {}", output), "Conversion");

    let duration = get_duration(input);
    log_info(&format!("Video süresi: {}", duration), "Conversion");

    let audio_rate = get_original_audio_rate(input);
    log_info(&format!("Ses bit hızı: {}", audio_rate), "Conversion");

    let min_size = get_target_size(audio_rate, duration);
    log_info(&format!("Minimum boyut: {}", min_size), "Conversion");

    // İlerleme başlangıcı olarak %0 bildirimi
    window.emit("conversion_progress", 0.0).unwrap();

    if !is_minsize(min_size, target_size) {
        log_error(&format!("Hata: Minimum boyut ({}) hedef boyuttan ({}) büyük!", min_size, target_size), "Conversion");
        println!("{min_size}");
        return "".to_string();
    }

    let target_bitrate = get_target_video_rate(target_size, duration, audio_rate);
    log_info(&format!("Hedef video bit hızı: {}", target_bitrate), "Conversion");

    // İlk geçiş
    window.emit("conversion_progress", 25.0).unwrap();
    log_info("İlk geçiş başlatıldı", "Conversion");
    convert_first(input, target_bitrate, start_time, end_time);
    log_info("İlk geçiş tamamlandı", "Conversion");

    // İkinci geçiş
    window.emit("conversion_progress", 50.0).unwrap();
    log_info("İkinci geçiş başlatıldı", "Conversion");
    convert_out(input, target_bitrate, audio_rate, &output, start_time, end_time, crop);
    log_info("İkinci geçiş tamamlandı", "Conversion");

    // Dosya kontrolü
    let output_path = Path::new(&output);
    if output_path.exists() {
        let metadata = std::fs::metadata(&output);
        if let Ok(meta) = metadata {
            let file_size = meta.len();
            log_info(&format!("Çıktı dosyası boyutu: {} bytes", file_size), "Conversion");

            if file_size == 0 {
                log_error("HATA: Çıktı dosyası 0 byte!", "Conversion");
            }
        } else {
            log_error("Çıktı dosyası metadata okunamadı", "Conversion");
        }
    } else {
        log_error("Çıktı dosyası oluşturulamadı", "Conversion");
    }

    // İşlem tamamlandı
    window.emit("conversion_progress", 100.0).unwrap();
    log_info(&format!("Video dönüştürme tamamlandı, çıktı: {}", output), "Conversion");

    return output;
}

// F12 tuşuna basıldığında DevTools açmak/kapatmak için
#[tauri::command(async)]
fn toggle_devtools(window: tauri::Window) {
    // DevTools açma işlemini kısa bir gecikme ile yap
    // Bu, React'in render döngüsü ile çakışma olasılığını azaltır
    std::thread::sleep(std::time::Duration::from_millis(300));

    // DevTools açmayı deneyelim ve log tutalım
    log_info("DevTools açılıyor...", "DevTools");
    window.open_devtools();
    log_info("DevTools açma komutu tamamlandı", "DevTools");
}

fn main() {
    log_info("Uygulama başlatıldı", "System");
    log_environment();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            convert_video,
            log_to_file_js,
            open_file_explorer,
            check_file_exists,
            check_video_url,
            toggle_devtools
        ])
        .setup(|app| {
            match app.get_cli_matches() {
                Ok(_matches) => {
                    log_info("CLI parametreleri alındı", "System");
                    println!("got matches");
                }
                Err(_) => {
                    log_info("CLI parametresi yok", "System");
                    println!("no matches");
                }
            };

            // Build modunda da DevTools'u etkinleştir
            log_info("DevTools erişimi etkinleştirildi", "System");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    log_info("Uygulama kapatıldı", "System");
}
