"""Apply the narrowly scoped WebView asset routing to the generated Android project."""
import argparse
from pathlib import Path
from chinu_voice import patch_voice

parser = argparse.ArgumentParser()
parser.add_argument("project", type=Path)
parser.add_argument("--preview", action="store_true")
args = parser.parse_args()
p = args.project / "app/src/main/java/com/meraassistant/Web.kt"
s = p.read_text(encoding="utf-8")
needle = "        web.webViewClient = object : WebViewClient() {"
assert s.count(needle) == 1
s = s.replace(needle, needle + """
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): android.webkit.WebResourceResponse? {
                val uri = request?.url ?: return null
                val path = uri.path ?: return null
                if (uri.scheme != "https" || uri.host != "chinu.app" || !path.startsWith("/realistic/")) return null
                if (!path.matches(Regex("/realistic/(runtime[.]js|assets/[A-Za-z0-9_.-]+)"))) return null
                val mime = when (path.substringAfterLast('.')) {
                    "js" -> "application/javascript"
                    "jpg" -> "image/jpeg"
                    "png" -> "image/png"
                    "ogg" -> "audio/ogg"
                    "glb", "vrm" -> "model/gltf-binary"
                    else -> "application/octet-stream"
                }
                return try {
                    android.webkit.WebResourceResponse(mime, if (mime == "application/javascript") "UTF-8" else null, assets.open("www" + path))
                } catch (_: java.io.IOException) {
                    android.webkit.WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
                }
            }
""")
if args.preview:
    needle = 'UiUpdater.html(this), "text/html"'
    assert s.count(needle) == 1
    s = s.replace(needle, 'assets.open("www/index.html").bufferedReader().use { it.readText() }, "text/html"')
p.write_text(s, encoding="utf-8")

patch_voice(args.project)
