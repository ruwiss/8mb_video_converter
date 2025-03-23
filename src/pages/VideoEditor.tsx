import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fromBase64, toBase64 } from "../utils";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";

// Video URL'sini loglayan yardımcı fonksiyon
const logVideoUrl = async (url: string, context: string) => {
  try {
    await invoke("log_to_file_js", {
      message: `Video URL (${context}): ${url}`,
      level: "info",
      category: "VideoURL",
    });
    console.log(`Video URL (${context}): ${url}`);

    // URL'nin geçerli olup olmadığını kontrol et
    if (url.startsWith("file://")) {
      await invoke("check_video_url", { url });
    }
  } catch (error) {
    console.error("Log hatası:", error);
  }
};

// Hata loglama için yardımcı fonksiyon
const logError = async (error: any, context: string) => {
  const errorMessage = error?.message || String(error);
  try {
    await invoke("log_to_file_js", {
      message: `Hata (${context}): ${errorMessage}`,
      level: "error",
      category: "Error",
    });
    console.error(`Hata (${context}):`, error);
  } catch (logError) {
    console.error("Log hatası:", logError);
  }
};

// TypeScript tanımlamaları için basit arayüzler
interface Crop {
  unit: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropSelection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

// Debug bilgisi için type
interface DebugInfo {
  decodedPath?: string;
  fileExists?: boolean;
  fileExistsError?: string;
  videoSrc?: string;
  convertFileSrcError?: string;
  decodedPathError?: string;
  playerError?: string;
  playerReady?: boolean;
  playerStarted?: boolean;
  playerBuffering?: boolean;
  isProduction?: boolean;
  envError?: string;
  mimeType?: string;
  videoFormat?: string;
  rawPath?: string;
  errorTimestamp?: string;
  originalPath?: string;
  cleanPath?: string;
  convertedUrl?: string;
  processedAt?: string;
  urlCreationError?: string;
  checkTime?: string;
  alternativeUrl?: string;
  recoveryAttempt?: boolean;
  fileExtension?: string;
  fileType?: string;
  assetUrl?: string;
  [key: string]: any;
}

export default function VideoEditor() {
  const router = useNavigate();
  const { filePath } = useParams();
  const decodedFilePath = filePath ? fromBase64(filePath) : "";

  const [videoUrl, setVideoUrl] = useState<string>(decodedFilePath);
  const [originalFilePath, setOriginalFilePath] = useState<string>(decodedFilePath);
  const [duration, setDuration] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [timeRange, setTimeRange] = useState({ start: 0, end: 100 });
  const [progress, setProgress] = useState<number>(0);
  // Çıkış boyutu için state ekle
  const [targetSize, setTargetSize] = useState<number>(8); // Varsayılan 8MB

  // Player hazır olduğunda true olacak
  const [playerReady, setPlayerReady] = useState<boolean>(false);

  // Hata durumları için state ekle
  const [loadError, setLoadError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({});

  // Crop durumu için güncellenmiş state
  const [cropMode, setCropMode] = useState<boolean>(false);
  const [cropSelection, setCropSelection] = useState<CropSelection | null>(null);
  const [crop, setCrop] = useState<Crop>({
    unit: "%",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });

  // Timeline thumbnail üretme için ref ve state
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  // ReactPlayer yerine HTML Video element referansı kullanıyoruz
  const videoRef = useRef<HTMLVideoElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);

  // Timeline sürükleme işlemleri için yeniden düzenleme
  const [isDraggingTimelineHandle, setIsDraggingTimelineHandle] = useState<"start" | "end" | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Video boyutları
  const videoWidth = 1280;
  const videoHeight = 720;

  // Video yükleme durumu için state
  const [isVideoLoading, setIsVideoLoading] = useState<boolean>(true);
  const [showDebugButton, setShowDebugButton] = useState<boolean>(true); // Debug düğmesini gösterme durumu

  // İşleme durumu mesajını için state
  const [processingMessage, setProcessingMessage] = useState<string>("Analyzing video...");

  // Timeline tıklama fonksiyonu
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (isDraggingTimelineHandle || !duration || !videoRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickPosition = (e.clientX - rect.left) / rect.width;
    const newTime = clickPosition * duration;

    // Oynatma konumunu güncelle
    setCurrentTime(newTime);
    videoRef.current.currentTime = newTime;
  };

  // Oynat butonuna tıklandığında başlangıç noktasından başlama
  const handlePlayButtonClick = () => {
    // Eğer video hala yükleniyor veya hata oluştuysa return et
    if (!videoUrl || !videoRef.current) return;

    // Play/pause durumunu değiştir
    setPlaying(!playing);

    // Debug için log
    logError(`Play durumu değiştirildi: ${!playing ? "play" : "pause"}`, "PlayButton");

    // Açıkça oynatıcıya oynatma komutu ver
    if (!playing) {
      // Play tuşuna basıldığında, eğer zaman aralığı geçerliyse
      // timeline başlangıç noktasından oynatmayı başlat
      if (timeRange.start > 0 && currentTime < timeRange.start) {
        // Başlangıç noktasına git
        videoRef.current.currentTime = timeRange.start;
        setCurrentTime(timeRange.start);
      }
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  // Timeline kesme tutamaçları için sürükleme başlat
  const handleTimelineHandleMouseDown = (handleType: "start" | "end") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDraggingTimelineHandle(handleType);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const position = (moveEvent.clientX - rect.left) / rect.width;
      const newTime = Math.max(0, Math.min(position * duration, duration));

      if (handleType === "start") {
        if (newTime < timeRange.end - 0.5) {
          setTimeRange((prev) => ({
            ...prev,
            start: newTime,
          }));

          // Başlangıç noktasını sürüklerken oynatma pozisyonunu da güncelle
          if (!playing && videoRef.current) {
            setCurrentTime(newTime);
            videoRef.current.currentTime = newTime;
          }
        }
      } else {
        if (newTime > timeRange.start + 0.5) {
          setTimeRange((prev) => ({
            ...prev,
            end: newTime,
          }));
        }
      }
    };

    const handleMouseUp = () => {
      setIsDraggingTimelineHandle(null);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // ReactPlayer için alternatif URL'ler oluşturacak fonksiyon ekleyelim
  const createPlayerUrl = (path: string): string => {
    try {
      // URL oluşturma işlemini logla
      invoke("log_to_file_js", {
        message: `URL oluşturuluyor: ${path}`,
        level: "info",
        category: "URLCreation",
      });

      // Path'i temizle
      let cleanPath = path;
      if (cleanPath.startsWith("file://")) {
        cleanPath = cleanPath.replace("file://", "");
      }

      // Debug için üretim ortamını belirle
      const isProd = import.meta.env.PROD ?? true; // Varsayılan olarak prod kabul et

      // Windows yolu düzeltme
      if (cleanPath.includes("\\")) {
        cleanPath = cleanPath.replace(/\\/g, "/");
        invoke("log_to_file_js", {
          message: `Windows yolu düzeltildi: ${cleanPath}`,
          level: "info",
          category: "URLCreation",
        });
      }

      // Her zaman convertFileSrc kullan (Tauri uygulamasında en güvenli yöntem)
      const url = convertFileSrc(cleanPath);

      // Debug bilgisini güncelle
      setDebugInfo((prev) => ({
        ...prev,
        originalPath: path,
        cleanPath: cleanPath,
        convertedUrl: url,
        isProduction: isProd,
        processedAt: new Date().toISOString(),
      }));

      // Oluşturulan URL'yi logla
      invoke("log_to_file_js", {
        message: `Oluşturulan URL: ${url} (Üretim modu: ${isProd ? "Evet" : "Hayır"})`,
        level: "info",
        category: "URLCreation",
      });

      return url;
    } catch (error) {
      // Hata durumunda logla
      invoke("log_to_file_js", {
        message: `URL oluşturma hatası: ${error}`,
        level: "error",
        category: "URLCreation",
      });
      console.error("URL oluşturma hatası:", error);
      setDebugInfo((prev) => ({ ...prev, urlCreationError: String(error) }));
      throw error;
    }
  };

  // Dosya formatını algılama fonksiyonu
  const detectFileType = (filePath: string) => {
    try {
      // Dosya uzantısını al
      const extension = filePath.toLowerCase().split(".").pop() || "";
      let fileType = "";

      switch (extension) {
        case "mp4":
          fileType = "video/mp4";
          break;
        case "webm":
          fileType = "video/webm";
          break;
        case "ogg":
          fileType = "video/ogg";
          break;
        case "avi":
          fileType = "video/avi";
          break;
        case "mov":
          fileType = "video/quicktime";
          break;
        case "mkv":
          fileType = "video/x-matroska";
          break;
        default:
          fileType = "video/mp4"; // Varsayılan format
      }

      return { extension, fileType };
    } catch (error) {
      console.error("Format algılama hatası:", error);
      return { extension: "unknown", fileType: "video/mp4" };
    }
  };

  // Video yüklendiğinde
  const handleVideoLoaded = () => {
    logError("Video hazır", "VideoReady");
    invoke("log_to_file_js", { message: `Video hazır - URL: ${videoUrl}` });
    logVideoUrl(videoUrl, "VideoReady");

    const videoElement = videoRef.current;
    if (videoElement) {
      setDebugInfo((prev) => ({
        ...prev,
        playerReady: true,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
      }));
      setDuration(videoElement.duration);
      setTimeRange({ start: 0, end: videoElement.duration });
      setPlayerReady(true);
      setLoadError(null);
      setIsVideoLoading(false);
    }
  };

  // Video hatası
  const handleVideoError = (error: any) => {
    logError(error || "Video yükleme hatası", "VideoError");
    invoke("log_to_file_js", {
      message: `Video yükleme hatası - URL: ${videoUrl}`,
      level: "error",
      category: "VideoError",
    });

    // Yolu detaylı logla
    if (originalFilePath) {
      invoke("log_to_file_js", {
        message: `Orijinal yol: ${originalFilePath}`,
        level: "error",
        category: "VideoError",
      });
    }

    // State güncelleme
    setLoadError(`Video yükleme hatası: ${String(error)}`);
    setDebugInfo((prev) => ({
      ...prev,
      playerError: error?.message || String(error),
      errorTimestamp: new Date().toISOString(),
    }));

    // Alternatif çözüm dene
    try {
      if (originalFilePath) {
        // Windows yollarındaki ters slash'ları düzelt
        const formattedPath = originalFilePath.replace(/\\/g, "/");
        const finalUrl = convertFileSrc(formattedPath);

        invoke("log_to_file_js", {
          message: `Manuel yükleme denemesi: ${finalUrl}`,
          level: "info",
          category: "ManualLoad",
        });

        setVideoUrl(finalUrl);
      }
    } catch (manualError) {
      console.error("Manuel yükleme hatası:", manualError);
    }
  };

  // Video zamanı güncellendi
  const handleTimeUpdate = () => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const currentSeconds = videoElement.currentTime;
    setCurrentTime(currentSeconds);

    // Eğer oynatma pozisyonu bitiş noktasına gelirse, başlangıç noktasına dön
    if (currentSeconds >= timeRange.end) {
      videoElement.currentTime = timeRange.start;
      setCurrentTime(timeRange.start);
    }

    // Eğer oynatma pozisyonu başlangıç noktasından önceyse, başlangıç noktasına getir
    if (currentSeconds < timeRange.start && playing) {
      videoElement.currentTime = timeRange.start;
      setCurrentTime(timeRange.start);
    }
  };

  // useEffect içinde video yükleme
  useEffect(() => {
    const loadVideo = async () => {
      try {
        if (!originalFilePath) {
          await invoke("log_to_file_js", {
            message: "Video yolu seçilmedi",
            level: "warning",
            category: "VideoLoading",
          });
          setLoadError("Video yolu seçilmedi");
          return;
        }

        // Video yükleme başladı, durumu güncelle
        setIsVideoLoading(true);
        setLoadError(null);

        // Dosya yolunu logla
        await invoke("log_to_file_js", {
          message: `Video dosya yolu: ${originalFilePath}`,
          level: "info",
          category: "VideoLoading",
        });

        try {
          // Dosya formatını belirle
          const { extension, fileType } = detectFileType(originalFilePath);

          // Debug için format bilgilerini güncelle
          setDebugInfo((prev) => ({
            ...prev,
            fileExtension: extension,
            fileType: fileType,
            originalPath: originalFilePath,
          }));

          // Üretim (production) modunda mıyız?
          const isProd = import.meta.env.PROD ?? true;

          await invoke("log_to_file_js", {
            message: `Üretim modu: ${isProd ? "Evet" : "Hayır"}, Format: ${extension}, MIME: ${fileType}`,
            level: "info",
            category: "VideoLoading",
          });

          // Dosya varlığını kontrol et
          const fileExists = await invoke("check_file_exists", { path: originalFilePath });

          // Debug bilgisini hemen güncelle
          setDebugInfo((prev) => ({
            ...prev,
            decodedPath: originalFilePath,
            fileExists,
            isProduction: isProd,
            checkTime: new Date().toISOString(),
          }));

          if (!fileExists) {
            throw new Error(`Dosya bulunamadı: ${originalFilePath}`);
          }

          // Video URL'sini oluştur
          const playerUrl = createPlayerUrl(originalFilePath);
          setVideoUrl(playerUrl);
          await logVideoUrl(playerUrl, "useEffect");

          setDebugInfo((prev) => ({
            ...prev,
            videoSrc: playerUrl,
          }));
        } catch (specificError) {
          await logError(specificError, "videoLoading");
          setLoadError(`Video yüklenemedi: ${String(specificError)}`);
          setIsVideoLoading(false);
        }
      } catch (error) {
        setIsVideoLoading(false);
        await logError(error, "loadVideo");
        setLoadError(`Beklenmeyen hata: ${String(error)}`);
      }
    };

    loadVideo();

    // Component unmount olduğunda
    return () => {
      // Olası memoryleak ve açık kaynakları temizle
      setVideoUrl("");
      setIsVideoLoading(false);
    };
  }, [originalFilePath]);

  // Video yüklendiğinde thumbnailleri oluştur
  useEffect(() => {
    if (duration > 0 && videoUrl) {
      generateThumbnails();
    }
  }, [duration, videoUrl]);

  // Video oynatma durumunu izle
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    if (playing) {
      // Promise destekli play işlemini çağır
      const playPromise = videoElement.play();

      // Play promise'i destekliyorsa
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.error("Video oynatma hatası:", error);
          setPlaying(false);
        });
      }
    } else {
      videoElement.pause();
    }
  }, [playing]);

  // Thumbnailleri oluşturma fonksiyonu
  const generateThumbnails = async () => {
    // Gerçek uygulamada FFmpeg ile yapılabilir, şimdilik basit bir görsel için temsili olarak oluşturuyoruz
    // Normalde backend tarafında ffmpeg ile frameleri alıp thumbnail olarak kullanmak gerekir
    const tempThumbs = [];
    const thumbnailCount = 10; // Timeline'daki thumbnail sayısı

    for (let i = 0; i < thumbnailCount; i++) {
      // Burada basit bir temsili renk kullanıyoruz, gerçek uygulamada video framelerini kullanmak gerekir
      const hue = (i / thumbnailCount) * 360;
      tempThumbs.push(`hsl(${hue}, 70%, 60%)`);
    }

    setThumbnails(tempThumbs);
  };

  // Crop seçim işlemleri
  const startCropSelection = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cropMode || !videoContainerRef.current) return;

    // Eğer tıklama bir metin üzerine olursa, crop işlemini başlatma
    if ((e.target as HTMLElement).closest(".text-overlay")) {
      return;
    }

    // Mouse'a basıldığında mevcut oynatma durumunu kaydet
    const wasPlaying = playing;
    if (playing) {
      setPlaying(false);
    }

    const container = videoContainerRef.current;
    const rect = container.getBoundingClientRect();

    // Fare pozisyonunu container içindeki oransal değerlere çevir
    const startX = ((e.clientX - rect.left) / rect.width) * 100;
    const startY = ((e.clientY - rect.top) / rect.height) * 100;

    // Başlangıç noktasında bile seçim alanını göstermek için aynı noktayı hem başlangıç hem bitiş olarak ayarla
    const initialSelection = {
      startX,
      startY,
      endX: startX,
      endY: startY,
    };

    setCropSelection(initialSelection);

    // Başlangıçta bile crop değerlerini güncelle (0x0 boyutunda olacak)
    setCrop({
      unit: "%",
      x: startX,
      y: startY,
      width: 0,
      height: 0,
    });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const endX = Math.max(0, Math.min(100, ((moveEvent.clientX - containerRect.left) / containerRect.width) * 100));
      const endY = Math.max(0, Math.min(100, ((moveEvent.clientY - containerRect.top) / containerRect.height) * 100));

      const newSelection = {
        startX,
        startY,
        endX,
        endY,
      };

      setCropSelection(newSelection);

      // Mouse hareket ederken sürekli crop değerlerini güncelle
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);

      setCrop({
        unit: "%",
        x,
        y,
        width,
        height,
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      // mouseup olduğunda cropSelection'dan final crop değerini ayarla
      if (cropSelection) {
        const x = Math.min(cropSelection.startX, cropSelection.endX);
        const y = Math.min(cropSelection.startY, cropSelection.endY);
        const width = Math.abs(cropSelection.endX - cropSelection.startX);
        const height = Math.abs(cropSelection.endY - cropSelection.startY);

        // Crop alanı çok küçük olmasın
        if (width < 1 || height < 1) {
          setCropSelection(null);
          setCrop({
            unit: "%",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          });
        } else {
          setCrop({
            unit: "%",
            x,
            y,
            width,
            height,
          });
        }
      }

      // Sürükleme öncesi oynuyorsa, durumu geri yükle, ama oynamıyorsa değişiklik yapma
      if (wasPlaying) {
        setPlaying(true);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Crop seçimi gösterme fonksiyonu
  const renderCropSelection = () => {
    if (!cropMode || !cropSelection) return null;

    const x = Math.min(cropSelection.startX, cropSelection.endX);
    const y = Math.min(cropSelection.startY, cropSelection.endY);
    const width = Math.abs(cropSelection.endX - cropSelection.startX);
    const height = Math.abs(cropSelection.endY - cropSelection.startY);

    return (
      <div
        className="absolute border-2 border-yellow-400 bg-yellow-400 bg-opacity-20"
        style={{
          left: `${x}%`,
          top: `${y}%`,
          width: `${width}%`,
          height: `${height}%`,
          pointerEvents: "none",
        }}
      >
        {/* Kenar noktaları */}
        <div className="absolute w-2 h-2 bg-yellow-400 left-0 top-0" />
        <div className="absolute w-2 h-2 bg-yellow-400 right-0 top-0" />
        <div className="absolute w-2 h-2 bg-yellow-400 left-0 bottom-0" />
        <div className="absolute w-2 h-2 bg-yellow-400 right-0 bottom-0" />
      </div>
    );
  };

  // useEffect ile event listener ekleyelim
  useEffect(() => {
    // Video işleme durumunu dinlemek için Tauri event listener
    const setupProcessListener = async () => {
      const unlisten = await listen("conversion_progress", (event: any) => {
        // Gelen progress değerini güncelle
        const progressValue = (event.payload as number) || 0;
        setProgress(progressValue);

        // İşlem ilerlemesine göre durumu güncelle
        if (progressValue <= 25) {
          setProcessingMessage("Analyzing video...");
        } else if (progressValue <= 50) {
          setProcessingMessage("Trimming content...");
        } else if (progressValue <= 75) {
          setProcessingMessage("Applying effects...");
        } else {
          setProcessingMessage("Optimizing output...");
        }
      });

      // Component kaldırıldığında event listener'ı temizle
      return () => {
        unlisten();
      };
    };

    setupProcessListener();
  }, []);

  const handleExport = async () => {
    try {
      // İşlem başlangıcında progress barı göster
      setProgress(1); // 0 olursa görünmeyeceği için 1'den başlatıyoruz
      setProcessingMessage("Starting process...");

      // Crop parametrelerini hazırla
      let cropSettings = null;

      // Crop modu aktif ve anlamlı bir seçim varsa (genişlik ve yükseklik 0'dan büyük olmalı)
      if (cropMode && crop.width > 0 && crop.height > 0 && crop.width < 100 && crop.height < 100) {
        cropSettings = {
          x: crop.x,
          y: crop.y,
          width: crop.width,
          height: crop.height,
          unit: crop.unit,
        };

        // Crop değerlerini konsola yazdır (debug için)
        console.log("Export edilecek crop değerleri:", cropSettings);

        // Log yardımcı bilgileri
        await invoke("log_to_file_js", {
          message: `Crop export değerleri: x=${crop.x}, y=${crop.y}, w=${crop.width}, h=${crop.height}`,
          level: "info",
          category: "VideoExport",
        });
      }

      // Video kesme, crop ve metin ekleme işlemlerini gerçekleştir
      const out: any = await invoke("convert_video", {
        input: originalFilePath,
        targetSize: targetSize,
        startTime: timeRange.start > 0 ? timeRange.start : null,
        endTime: timeRange.end < duration ? timeRange.end : null,
        crop: cropSettings,
      });

      // İşlem bittiğinde progress'i temizle
      setProgress(0);

      if (!out) {
        await invoke("log_to_file_js", {
          message: "Dönüştürme işlemi başarısız oldu veya boş sonuç döndü",
          level: "error",
          category: "VideoExport",
        });
        return;
      }

      router(`/success/${toBase64(out)}`);
    } catch (err) {
      // Hata durumunda progress'i temizle
      setProgress(0);
      console.error("Export error:", err);

      // Hatayı logla
      await invoke("log_to_file_js", {
        message: `Dönüştürme hatası: ${String(err)}`,
        level: "error",
        category: "VideoExport",
      });
    }
  };

  // Video formatı belirleme için yardımcı fonksiyon
  const getVideoFormat = (path: string): string => {
    const extension = path.toLowerCase().split(".").pop() || "";
    return extension;
  };

  // MIME tipi belirleme için yardımcı fonksiyon
  const getMimeType = (path: string): string => {
    const extension = path.toLowerCase().split(".").pop() || "";
    const mimeTypes: { [key: string]: string } = {
      mp4: "video/mp4",
      webm: "video/webm",
      ogg: "video/ogg",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      wmv: "video/x-ms-wmv",
      flv: "video/x-flv",
      mkv: "video/x-matroska",
    };

    return mimeTypes[extension] || "video/mp4";
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-3">
      {/* Debug bilgisi görüntüle */}
      {loadError && (
        <div className="fixed top-0 left-0 right-0 bg-red-600 text-white p-2 z-50">
          Hata: {loadError}
          <button
            className="ml-2 bg-white text-red-600 px-2 py-0.5 rounded text-xs"
            onClick={() => {
              alert(JSON.stringify(debugInfo, null, 2));
              logError(JSON.stringify(debugInfo, null, 2), "DebugInfo");
            }}
          >
            Debug Bilgisi
          </button>
        </div>
      )}

      {/* Her zaman görünür debug butonu */}
      {showDebugButton && (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded-full shadow-lg"
            onClick={() => {
              alert(JSON.stringify(debugInfo, null, 2));
              logError(JSON.stringify(debugInfo, null, 2), "DebugButton");
            }}
          >
            Debug Bilgisi
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
        {/* Video Önizleme ve Timeline */}
        <div className="lg:col-span-5 bg-gray-800 rounded-lg p-3 shadow-lg">
          {/* Video Container */}
          <div className="relative mx-auto" style={{ width: `${videoWidth}px`, maxWidth: "100%" }}>
            <div ref={videoContainerRef} className="relative bg-black rounded-lg overflow-hidden shadow-lg" style={{ aspectRatio: `${videoWidth}/${videoHeight}` }} onMouseDown={cropMode ? startCropSelection : undefined}>
              {videoUrl ? (
                <div className="relative w-full h-full">
                  {/* HTML5 Video elementi kullanıyoruz */}
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full h-full"
                    onLoadedMetadata={handleVideoLoaded}
                    onError={(e) => handleVideoError(e)}
                    onTimeUpdate={handleTimeUpdate}
                    controls={false}
                    controlsList="nodownload"
                    crossOrigin="anonymous"
                    playsInline
                    style={{ display: isVideoLoading ? "none" : "block" }}
                  />

                  {isVideoLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-40">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-2"></div>
                        <p className="text-white text-sm">Video yükleniyor...</p>
                        <p className="text-gray-300 text-xs mt-1">{videoUrl ? "URL hazır" : "URL bekleniyor..."}</p>
                        <p className="text-gray-300 text-xs mt-1 break-all max-w-md overflow-hidden">{videoUrl ? videoUrl.substring(0, 50) + "..." : "URL yok"}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500">Video could not be loaded</div>
              )}

              {/* Crop Seçim Alanı - z-index 20 olacak */}
              {renderCropSelection()}
            </div>

            {/* Özel Video Kontrolleri */}
            <div className="mt-3 flex items-center justify-center space-x-2">
              <button onClick={handlePlayButtonClick} className={`p-2 rounded-full ${!videoUrl ? "bg-gray-700 text-gray-500 cursor-not-allowed" : playing ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"} transition-colors`} disabled={!videoUrl}>
                {playing ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </button>
              <div className="text-xs">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
              <div className="flex-grow"></div>
              <button className={`p-2 rounded-md transition-colors flex items-center ${cropMode ? "bg-yellow-500 hover:bg-yellow-600" : "bg-gray-600 hover:bg-gray-700"}`} onClick={() => setCropMode(!cropMode)}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1H5zm9 2H6v8h8V6z" clipRule="evenodd" />
                </svg>
                <span className="ml-1 text-xs">{cropMode ? "Crop Enabled" : "Crop Disabled"}</span>
              </button>
            </div>
          </div>

          {/* Timeline Görsel Şeridi */}
          <div className="mt-3 mx-auto" style={{ width: `${videoWidth}px`, maxWidth: "100%" }}>
            {/* Thumbnail şeridi */}
            <div ref={timelineRef} className="relative h-16 bg-gray-700 rounded-lg overflow-hidden cursor-pointer shadow-md" onClick={handleTimelineClick}>
              <div className="flex h-full">
                {thumbnails.map((color, index) => (
                  <div key={index} className="flex-1 h-full" style={{ backgroundColor: color }} />
                ))}
              </div>

              {/* Seçim alanı */}
              <div
                className="absolute top-0 h-full bg-blue-500 bg-opacity-30 border-2 border-blue-500 pointer-events-none"
                style={{
                  left: `${(timeRange.start / duration) * 100}%`,
                  width: `${((timeRange.end - timeRange.start) / duration) * 100}%`,
                }}
              />

              {/* Başlangıç tutamacı */}
              <div className="absolute top-0 bottom-0 w-3 bg-blue-600 cursor-ew-resize z-10" style={{ left: `${(timeRange.start / duration) * 100}%`, marginLeft: "-3px" }} onMouseDown={handleTimelineHandleMouseDown("start")} onClick={(e) => e.stopPropagation()} />

              {/* Bitiş tutamacı */}
              <div className="absolute top-0 bottom-0 w-3 bg-blue-600 cursor-ew-resize z-10" style={{ left: `${(timeRange.end / duration) * 100}%`, marginLeft: "0px" }} onMouseDown={handleTimelineHandleMouseDown("end")} onClick={(e) => e.stopPropagation()} />

              {/* Geçerli zaman göstergesi */}
              <div className="absolute top-0 h-full w-0.5 bg-white z-20 pointer-events-none" style={{ left: `${(currentTime / duration) * 100}%` }} />
            </div>

            {/* Mevcut zaman ve süre bilgisi */}
            <div className="flex justify-between mt-1">
              <div className="flex items-center">
                <label className="text-xs text-gray-400 mr-1">Start:</label>
                <input type="text" value={formatTime(timeRange.start)} className="w-16 bg-gray-700 text-white px-1 py-0.5 text-xs rounded-md border border-gray-600 cursor-not-editable" readOnly />
              </div>
              <div className="flex items-center">
                <label className="text-xs text-gray-400 mr-1">End:</label>
                <input type="text" value={formatTime(timeRange.end)} className="w-16 bg-gray-700 text-white px-1 py-0.5 text-xs rounded-md border border-gray-600 cursor-not-editable" readOnly />
              </div>
            </div>
          </div>
        </div>

        {/* Ayarlar Paneli */}
        <div className="lg:col-span-2 bg-gray-800 p-3 rounded-lg shadow-lg flex flex-col overflow-auto">
          <h2 className="text-lg font-semibold mb-2 border-b border-gray-700 pb-1">Settings</h2>

          {progress > 0 && progress < 100 ? (
            <div className="mb-3">
              <h3 className="text-base mb-1">Processing Video</h3>

              {/* Gelişmiş progress bar */}
              <div className="mb-4">
                <div className="w-full bg-gray-700 rounded-full h-4 mb-2 overflow-hidden">
                  <div className="bg-blue-600 h-4 rounded-full transition-all duration-300 ease-in-out relative" style={{ width: `${progress}%` }}>
                    {/* Animasyonlu yükleme efekti */}
                    <div className="absolute inset-0 bg-white bg-opacity-20 overflow-hidden">
                      <div className="animate-pulse w-full h-full opacity-25" />
                    </div>
                  </div>
                </div>

                {/* Progress yüzdesi */}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Progress</span>
                  <span className="font-medium text-white">{Math.round(progress)}%</span>
                </div>
              </div>

              {/* İşleme aşamaları */}
              <div className="bg-gray-700 p-2 rounded-md mb-2">
                <div className="text-xs text-gray-300 mb-1">Current operation:</div>
                <div className="flex items-center">
                  <div className="animate-spin mr-2 h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                  <span className="text-sm">{processingMessage}</span>
                </div>
              </div>

              {/* Tahmini kalan süre (gerçek bir hesaplama yok) */}
              <div className="text-center text-xs text-gray-400">Please wait while your video is being processed...</div>
            </div>
          ) : (
            <>
              {/* Crop ve Text Araçları */}
              <div className="mb-3">
                {/* Crop Bilgileri */}
                <div className="mb-3 bg-gray-700 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-300">Crop Tool</p>
                    <button className={`px-2 py-1 text-xs rounded-md ${cropMode ? "bg-yellow-500 hover:bg-yellow-600" : "bg-gray-600 hover:bg-gray-700"}`} onClick={() => setCropMode(!cropMode)}>
                      {cropMode ? "Enabled" : "Disabled"}
                    </button>
                  </div>

                  <p className="text-xs text-gray-400 mb-2">{cropMode ? "Drag on the video to crop" : "Enable crop mode to select an area"}</p>

                  {crop.width > 0 && crop.height > 0 && crop.width < 100 && crop.height < 100 && (
                    <div className="flex flex-col space-y-2">
                      <div className="grid grid-cols-4 gap-1 mb-1 text-center">
                        <div>
                          <label className="text-xs text-gray-400">X:</label>
                          <div className="bg-gray-600 py-0.5 px-1 rounded text-xs">{crop.x.toFixed(1)}%</div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-400">Y:</label>
                          <div className="bg-gray-600 py-0.5 px-1 rounded text-xs">{crop.y.toFixed(1)}%</div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-400">W:</label>
                          <div className="bg-gray-600 py-0.5 px-1 rounded text-xs">{crop.width.toFixed(1)}%</div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-400">H:</label>
                          <div className="bg-gray-600 py-0.5 px-1 rounded text-xs">{crop.height.toFixed(1)}%</div>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setCrop({
                            unit: "%",
                            x: 0,
                            y: 0,
                            width: 100,
                            height: 100,
                          });
                          setCropSelection(null);
                        }}
                        className="bg-red-600 hover:bg-red-700 px-2 py-1 rounded-md w-full transition-colors text-xs"
                      >
                        Reset Crop
                      </button>
                    </div>
                  )}
                </div>

                {/* Çıkış boyutu seçimi */}
                <div className="mb-3">
                  <label className="text-sm text-gray-300 mb-1 block">Output Size (MB)</label>
                  <div className="flex items-center space-x-2">
                    <input type="range" min="1" max="50" value={targetSize} onChange={(e) => setTargetSize(parseInt(e.target.value))} className="flex-grow h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
                    <span className="text-sm font-medium bg-gray-700 px-2 py-1 rounded-md min-w-[40px] text-center">{targetSize}</span>
                  </div>
                </div>

                {/* İşlem Butonları */}
                <div className="mt-auto space-y-2">
                  <button onClick={handleExport} className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-md w-full transition-colors flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    Process Video
                  </button>

                  <button onClick={() => router("/")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded-md w-full transition-colors text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Yardımcı fonksiyonlar
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
