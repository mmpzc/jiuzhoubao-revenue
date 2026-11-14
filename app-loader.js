(async () => {
  const partFiles = ["./app-part1.js", "./app-part2.js", "./app-part3.js"];
  try {
    const responses = await Promise.all(partFiles.map(async file => {
      const response = await fetch(file, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
      return response.text();
    }));
    const code = responses.join("\n");
    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(error);
    const notice = document.createElement("div");
    notice.style.cssText = "margin:16px;padding:14px;border-radius:12px;background:#fff3f0;color:#9f271d;font:14px/1.6 sans-serif;";
    notice.textContent = "页面加载失败，请刷新后重试。";
    document.body.prepend(notice);
  }
})();