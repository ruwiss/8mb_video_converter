import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Route, Routes } from "react-router-dom";
import Menu from "./pages/Menu";
import Convert from "./pages/Convert";
import { message } from "@tauri-apps/api/dialog";
import Success from "./pages/Success";
import VideoEditor from "./pages/VideoEditor";

function App() {
  const [video, setVideo] = useState<string>();
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <div className="bg-black h-screen">
      <Routes>
        <Route path="/" element={<Menu />} />
        <Route path="/editor/:filePath" element={<VideoEditor />} />
        <Route path="/convert/:filePath" element={<Convert />} />
        <Route path="/success/:outputFolder" element={<Success />} />
      </Routes>
    </div>
  );
}

export default App;
