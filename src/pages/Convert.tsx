import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { message } from "@tauri-apps/api/dialog";
import { invoke } from "@tauri-apps/api";
import debounce from "lodash.debounce";
import { fromBase64, toBase64 } from "../utils";
import { listen } from "@tauri-apps/api/event";

export default function Convert() {
  const router = useNavigate();
  const [convertStatus, setConvertStatus] = useState<string>("Compressing");
  const [progress, setProgress] = useState<number>(0);
  const [fail, setFail] = useState<boolean>(false);
  const { filePath } = useParams();

  useEffect(() => {
    // İlerleme durumunu dinleyen fonksiyon
    const unlistenProgress = listen("conversion_progress", (event) => {
      setProgress(event.payload as number);
    });

    // Component unmount edildiğinde listener'ı kaldırıyoruz
    return () => {
      unlistenProgress.then((unlisten) => unlisten());
    };
  }, []);

  const convertVideo = async () => {
    try {
      if (!filePath) {
        message("No file");
        return;
      }

      const decodedFilePath = fromBase64(filePath);

      setProgress(0);

      const out: any = await invoke("convert_video", {
        input: decodedFilePath,
        targetSize: 8,
      });

      if (!out) {
        setConvertStatus("Failed to convert. Video can not be compressed to 8mb");
        setFail(true);
        return;
      }

      setConvertStatus("Successfully converted");
      setProgress(100);

      return router(`/success/${toBase64(out)}`);
    } catch (err: any) {
      setConvertStatus("An unexpected error has occured. Check the console for details.");
      console.log(err);
    }
  };

  const debouncedEventHandler = useMemo(() => debounce(convertVideo, 300), []);
  useEffect(() => {
    debouncedEventHandler();
  }, []);

  return (
    <div className="h-screen flex flex-col justify-center items-center">
      <div className="flex flex-col justify-center items-center">
        <h1 className="text-white text-2xl font-bold text-center mb-4">{convertStatus}</h1>

        {/* Progress Bar */}
        <div className="w-64 bg-gray-700 rounded-full h-4 mb-4">
          <div className="bg-blue-500 h-4 rounded-full transition-all duration-300 ease-in-out" style={{ width: `${progress}%` }}></div>
        </div>
        <div className="text-white mb-4">{progress.toFixed(0)}%</div>

        <svg className="text-white" height={42} width={42} version="1.1" id="L9" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 100 100" enableBackground="new 0 0 0 0" xmlSpace="preserve">
          <path fill="#fff" d="M73,50c0-12.7-10.3-23-23-23S27,37.3,27,50 M30.9,50c0-10.5,8.5-19.1,19.1-19.1S69.1,39.5,69.1,50">
            <animateTransform attributeName="transform" attributeType="XML" type="rotate" dur="1s" from="0 50 50" to="360 50 50" repeatCount="indefinite" />
          </path>
        </svg>
      </div>
      {fail == true ? (
        <div className="flex justify-center items-center">
          <button onClick={() => router("/")} className="bg-gray-800 text-gray-300 mt-2 px-2 py-1.5">
            Go Back to Menu
          </button>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}
