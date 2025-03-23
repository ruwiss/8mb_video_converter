use directories::{self, UserDirs};
use serde::{Deserialize, Serialize};
use std::fs::create_dir_all;
use std::path::Path;
use std::path::PathBuf;
use std::env;
use tauri::api::process::Command;
use serde_json;

#[derive(Serialize, Deserialize)]
/// file path is the full path inluding the video name, and output_dir is only the output dir
pub struct OutFile {
    pub full_path: String,
    pub explorer_dir: String,
}

impl OutFile {
    pub fn new(file_path: String, output_dir: String) -> Self {
        OutFile {
            full_path: file_path,
            explorer_dir: output_dir,
        }
    }

    pub fn empty() -> Self {
        OutFile {
            full_path: "".to_string(),
            explorer_dir: "".to_string(),
        }
    }
}

fn remove_whitespace(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

// copy ffmpeg-adsf to ffmpeg
pub fn get_duration(input: &str) -> f32 {
    let output = Command::new_sidecar("ffprobe")
        .expect("failed to find ffprobe sidecar")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            input,
        ])
        // TODO: write custom error handler
        .output()
        .expect("Failed to run ffprobe to get duration")
        .stdout;

    let duration = remove_whitespace(&output);

    let parsed: f32 = duration.parse().unwrap();

    parsed
}

/// Returns in kb
pub fn get_original_audio_rate(input: &str) -> f32 {
    let out = Command::new_sidecar("ffprobe")
        .expect("failed to find ffprobe sidecar")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=bit_rate",
            "-of",
            "csv=p=0",
            input,
        ])
        .output()
        .expect("Failed to run ffprobe to get original audio rate");

    let output = out.stdout;

    let arate = remove_whitespace(&output);

    if arate == "N/A" {
        return 0.00;
    }

    println!("arate {}", arate);

    let parsed: f32 = arate
        .parse::<f32>()
        .expect("Failed to parse original audio rate")
        / 1024.00;

    println!("arate: {}", arate);

    parsed
    // use 7.8
}

pub fn get_target_size(audio_rate: f32, duration: f32) -> f32 {
    let size = (audio_rate * duration) / 8192.00;
    size
}

pub fn is_minsize(min_size: f32, size: f32) -> bool {
    return min_size < size;
}

/// returns in kib/s
pub fn get_target_video_rate(size: f32, duration: f32, audio_rate: f32) -> f32 {
    let size = (size * 8192.00) / (1.048576 * duration) - audio_rate;
    size
}

pub fn convert_first(input: &str, video_bitrate: f32, start_time: Option<f32>, end_time: Option<f32>) {
    let temp_dir = env::temp_dir();
    let nul = if env::consts::OS == "windows" {
        "nul"
    } else {
        "/dev/null"
    };

    // Formatlı stringleri önceden oluştur (ömür sorunlarını önlemek için)
    let bitrate_str = format!("{}k", video_bitrate);
    let passlog_str = temp_dir.to_str().expect("Failed to convert temp dir to string");

    // İki aşamalı encoding yaparken ilk aşamada da zaman parametrelerini doğru sırada uygulamalıyız
    // Bu, kesme + crop kombinasyonunda 0 byte video oluşma sorununu çözer

    // Temel parametreler
    let mut args = vec!["-y".to_string()];

    // Start time kesinlikle input'tan önce gelmeli
    if let Some(start) = start_time {
        if start > 0.0 {
            args.push("-ss".to_string());
            args.push(start.to_string());
        }
    }

    // Input dosyası
    args.push("-i".to_string());
    args.push(input.to_string());

    // End time input'tan sonra gelmeli
    if let Some(end) = end_time {
        // Video süresini hesapla
        if let Some(start) = start_time {
            if end > start {
                // Başlangıç ve bitiş varsa: süre = bitiş - başlangıç
                let duration = end - start;
                args.push("-t".to_string());  // -to yerine -t kullan (süre)
                args.push(duration.to_string());
            } else {
                // Bitiş başlangıçtan küçükse hatalı durum - -to ile devam et
                args.push("-to".to_string());
                args.push(end.to_string());
            }
        } else {
            // Sadece bitiş zamanı varsa -to kullan
            args.push("-to".to_string());
            args.push(end.to_string());
        }
    }

    // Diğer parameterler
    args.extend(vec![
        "-c:v".to_string(),
        "libx264".to_string(),
        "-passlogfile".to_string(),
        passlog_str.to_string(),
        "-filter:v".to_string(),
        "scale=1280:-2".to_string(),
        "-b:v".to_string(),
        bitrate_str,
        "-pass".to_string(),
        "1".to_string(),
        "-an".to_string(),           // Ses yok
        "-f".to_string(),
        "mp4".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        nul.to_string()
    ]);

    // Debug için komutu yazdır
    let cmd_str = args.join(" ");
    println!("İlk geçiş FFmpeg komutu: {}", cmd_str);

    // Hata yakalama ile çalıştır
    match Command::new_sidecar("ffmpeg")
        .expect("failed to get ffmpeg sidecar")
        .args(args)
        .output() {
            Ok(cmd_output) => {
                println!("İlk geçiş tamamlandı");

                // Hata çıktısını kontrol et
                let stderr_str = String::from_utf8_lossy(cmd_output.stderr.as_bytes());
                if !stderr_str.is_empty() {
                    println!("İlk geçiş FFmpeg stderr:");
                    println!("------- İLK GEÇİŞ STDERR BAŞLANGICI -------");
                    println!("{}", stderr_str);
                    println!("------- İLK GEÇİŞ STDERR SONU -------");
                }
            },
            Err(e) => {
                println!("FFmpeg ilk geçiş hatası: {}", e);
                panic!("FFmpeg ilk geçiş hatası: {}", e);
            }
        };
}

pub fn convert_out(
    input: &str,
    video_bitrate: f32,
    audio_bitrate: f32,
    output: &str,
    start_time: Option<f32>,
    end_time: Option<f32>,
    crop: Option<serde_json::Value>
) {
    let temp_dir = env::temp_dir();

    // Create a PathBuf from the output string
    let output_path = PathBuf::from(output);

    // Get the parent directory
    let parent_dir = output_path.parent().unwrap();

    // Create the parent directory if it doesn't exist
    create_dir_all(parent_dir).unwrap();

    // Format değerlerini önceden oluştur
    let abi = if audio_bitrate == 0.00 {
        "copy".to_string()
    } else {
        format!("{}k", audio_bitrate)
    };

    // Passlog ve bitrate değerlerini önceden oluştur
    let bitrate_str = format!("{}k", video_bitrate);
    let passlog_str = temp_dir.to_str().expect("Failed to convert temp dir to string").to_string();

    // İlk geçiş - video analizi için
    println!("İlk geçiş başlatılıyor...");
    convert_first(
        input,
        video_bitrate,
        start_time,
        end_time
    );

    println!("İkinci geçiş başlatılıyor...");

    // Komut oluşturma
    let mut args = Vec::new();

    // 1. Global parametreler
    args.push("-y".to_string()); // Var olan dosyanın üzerine yaz

    // 2. Input parametreleri - SEEK ÖNEMLİ: Önce -ss, sonra -i
    if let Some(start) = start_time {
        if start > 0.0 {
            args.push("-ss".to_string());
            args.push(start.to_string());
        }
    }

    // 3. Input belirt
    args.push("-i".to_string());
    args.push(input.to_string());

    // 4. End time parametresi (input'tan SONRA)
    if let Some(end) = end_time {
        // Video süresini hesapla
        if let Some(start) = start_time {
            if end > start {
                // Başlangıç ve bitiş varsa: süre = bitiş - başlangıç
                let duration = end - start;
                args.push("-t".to_string());  // -to yerine -t kullan (süre)
                args.push(duration.to_string());
            } else {
                // Bitiş başlangıçtan küçükse hatalı durum - -to ile devam et
                args.push("-to".to_string());
                args.push(end.to_string());
            }
        } else {
            // Sadece bitiş zamanı varsa -to kullan
            args.push("-to".to_string());
            args.push(end.to_string());
        }
    }

    // 5. Video codec parametreleri
    args.extend(vec![
        "-c:v".to_string(),
        "libx264".to_string(),
        "-passlogfile".to_string(),
        passlog_str.clone(),
    ]);

    // 6. Filtergraph zinciri - doğru sıralama ÇOK önemli
    let mut filters = Vec::new();

    // Crop filter MUTLAKA ilk sırada
    let mut _has_crop = false;
    if let Some(ref crop_settings) = crop {
        if let Some(crop_map) = crop_settings.as_object() {
            if let (Some(x), Some(y), Some(width), Some(height)) = (
                crop_map.get("x").and_then(|v| v.as_f64()),
                crop_map.get("y").and_then(|v| v.as_f64()),
                crop_map.get("width").and_then(|v| v.as_f64()),
                crop_map.get("height").and_then(|v| v.as_f64())
            ) {
                // Crop sadece geçerli değerler için uygula
                if width > 0.0 && height > 0.0 && width < 100.0 && height < 100.0 {
                    // Referans boyutu
                    let video_width = 1280.0;  // Referans genişlik
                    let video_height = 720.0;  // Referans yükseklik

                    // Piksel değerlerine çevir - video boyutuna göre piksel hesapla
                    let x_px = (x / 100.0 * video_width).round();
                    let y_px = (y / 100.0 * video_height).round();
                    let width_px = (width / 100.0 * video_width).round();
                    let height_px = (height / 100.0 * video_height).round();

                    // Boyut sınırlarını kontrol et - hata riskini azalt
                    if width_px >= 16.0 && height_px >= 16.0 {
                        // FFmpeg crop formatı: crop=width:height:x:y
                        let crop_filter = format!("crop={}:{}:{}:{}",
                            width_px, height_px, x_px, y_px);
                        filters.push(crop_filter);
                        _has_crop = true;

                        println!("Crop uygulanıyor: {}:{}:{}:{} (x={}, y={}, w={}, h={})",
                            width_px, height_px, x_px, y_px, x, y, width, height);
                    } else {
                        println!("Çok küçük crop boyutları, atlanıyor: {}x{}", width_px, height_px);
                    }
                } else {
                    println!("Geçersiz crop yüzdeleri, atlanıyor: {}x{}", width, height);
                }
            }
        }
    }

    // Scale filter her zaman croptan sonra
    // Crop yoksa -2 ile otomatik yükseklik hesapla
    // Crop varsa, seçilen bölge doğru boyutta gösterilsin
    if _has_crop {
        filters.push("scale=1280:-2".to_string());
    } else {
        filters.push("scale=1280:-2".to_string());
    }

    // 7. Filtre zincirini ekle
    let filter_chain = filters.join(",");

    // Filtreleri yalnızca geçerli olduğunda ekle
    if !filter_chain.is_empty() {
        args.push("-filter:v".to_string());
        args.push(filter_chain.clone());
        println!("FFmpeg filtre zinciri: {}", filter_chain);
    }

    // 8. İkinci geçiş parametreleri
    args.extend(vec![
        "-b:v".to_string(),
        bitrate_str,
        "-pass".to_string(),
        "2".to_string(),
    ]);

    // 9. Ses parametreleri
    args.extend(vec![
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        abi,
    ]);

    // 10. Video format parametreleri - video player'larda daha iyi oynatılması için
    args.extend(vec![
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-f".to_string(),
        "mp4".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
    ]);

    // 11. Output dosyası
    args.push(output.to_string());

    // FFmpeg komutunu yazdır
    let cmd_str = args.join(" ");
    println!("FFmpeg ikinci geçiş komutu: {}", cmd_str);

    // Komutu çalıştır ve hataları yakala
    match Command::new_sidecar("ffmpeg")
        .expect("failed to get ffmpeg sidecar")
        .args(args)
        .output() {
            Ok(cmd_output) => {
                println!("İkinci geçiş tamamlandı - çıktı kontrol ediliyor");

                // Hata çıktısını göster (önemli)
                let stderr_str = String::from_utf8_lossy(cmd_output.stderr.as_bytes());
                if !stderr_str.is_empty() {
                    println!("FFmpeg stderr tam çıktı:");
                    println!("------- STDERR BAŞLANGICI -------");
                    println!("{}", stderr_str);
                    println!("------- STDERR SONU -------");
                }

                // Output dosyayı kontrol et
                let output_path = Path::new(&output);
                if output_path.exists() {
                    if let Ok(metadata) = std::fs::metadata(&output) {
                        println!("Output dosya boyutu: {} bytes", metadata.len());
                        if metadata.len() == 0 {
                            println!("HATA: Output dosya 0 byte! FFmpeg bir hata oluşturmuş olabilir.");
                        } else {
                            println!("Başarılı: Dosya boyutu > 0");
                        }
                    }
                } else {
                    println!("HATA: Output dosya oluşturulamadı!");
                }
            },
            Err(e) => {
                println!("FFmpeg ikinci geçiş hatası: {}", e);
                panic!("FFmpeg ikinci geçiş hatası: {}", e);
            }
        };
}

pub fn get_output(input: &str) -> String {
    let file_path = Path::new(input);
    let user_dirs = UserDirs::new().expect("Failed to find user dirs");

    let vid_dir = match user_dirs.video_dir() {
        Some(vid_dir) => vid_dir.as_os_str().to_str().unwrap(),
        _ => {
            // if video dir fails, use the parent dir of the clip
            match file_path.parent() {
                Some(dir) => dir.as_os_str().to_str().unwrap(),
                // use current dir
                _ => ".",
            }
        }
    };

    let file_name = match file_path.file_stem() {
        Some(name) => name.to_str().unwrap(),
        _ => {
            panic!("No file name")
        }
    };

    let file_out = format!("{}-8m.mp4", file_name);
    let output_path = Path::new(vid_dir)
        .join(file_out)
        .as_os_str()
        .to_str()
        .unwrap()
        .to_string();

    output_path
}
