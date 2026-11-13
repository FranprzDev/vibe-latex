# Vibe LaTeX

Dictá ecuaciones en español y convertí lo que vas explicando en Markdown y LaTeX dentro de Obsidian. Podés narrar una resolución paso a paso sin dictar comandos de LaTeX.

> “la integral de a a b de efe de equis de equis” → `$\int_a^b f(x)\,dx$`

## Instalación

a. **BRAT (recomendado)**: instalá el plugin [BRAT](https://github.com/TfTHacker/obsidian42-brat) desde la lista de plugins de la comunidad. En los ajustes de BRAT usá **Add beta plugin** y pegá `FranprzDev/vibe-latex`; BRAT instala y mantiene actualizado el plugin.

b. **Manual**: descargá `main.js` y `manifest.json` del último release en GitHub y copialos en `<tu-vault>/.obsidian/plugins/vibe-latex/`, después habilitá **Vibe LaTeX** en Ajustes → Plugins de la comunidad.

c. **Desde el código fuente**: `npm install && npm run build` y `./install.sh /ruta/a/tu/vault`.

## Uso

1. Ejecutá **Vibe LaTeX: Iniciar o detener el dictado por voz** desde la paleta de comandos o con el atajo `Cmd/Ctrl+Shift+M`.
2. Dictá en español. Las pausas separan fragmentos y cada resultado se inserta en la nota.
3. Volvé a ejecutar el comando para terminar.

Para corregir el último fragmento, ejecutá **Vibe LaTeX: Corregir la última frase dictada** (`Cmd/Ctrl+Shift+R`) y volvé a dictar ese fragmento completo. La corrección recuerda la última frase incluso después de reiniciar Obsidian, siempre que la nota no haya cambiado. También podés seleccionar texto existente en la nota e iniciar el dictado para reemplazarlo con voz.

## Qué convierte

- Texto explicativo en español mezclado con ecuaciones.
- Derivaciones de varios pasos, sustituciones, fracciones parciales, transformadas y límites, respetando el orden dictado.
- Vocabulario matemático hablado, como “equis”, “i griega”, “de equis”, “alfa” e “infinito”.
- Anotaciones de gráficos descriptas en voz.

El plugin convierte lo que se dicta; no debe completar ni corregir pasos matemáticos que no se hayan dicho. La conversión usa la API de OpenAI por defecto, o un endpoint local gratuito (ver **Modo local**). OpenAI puede cobrar el uso según la cuenta del usuario.

## Modo local (gratis, sin nube)

Podés usar el plugin sin clave ni costos con servidores locales. El plugin puede instalarlos y administrarlos solo, o podés levantarlos vos mismo.

### Instalación automática (recomendada)

1. Abrí **Ajustes → Vibe LaTeX → Modo local (gratis, sin nube)**.
2. Presioná **Instalar modo local**. El plugin descarga y configura todo solo:
   - **Transcripción**: el servidor de [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`whisper-server`) con el modelo **whisper small** (`ggml-small.bin`).
   - **Conversión**: [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) con el modelo **Qwen3.5 9B** en cuantización Q4_K_M.
   - Los servidores escuchan en los puertos **10000** (transcripción) y **8082** (conversión), configurables desde los mismos ajustes. En Windows la conversión usa la variante Vulkan de llama.cpp, que acelera con la GPU usando los drivers normales de NVIDIA, AMD o Intel.
3. Al terminar, el plugin activa el proveedor local, inicia los servidores y deja el dictado listo. La primera instalación descarga unos **6,5 GB** (whisper small ~0,5 GB + Qwen3.5 9B ~6 GB) y necesita unos **8 GB** de disco libre.

El resto de los ajustes (puertos, endpoints, modelos, prompts y grabación) están en la sección desplegable **Avanzado**, debajo del bloque de modo local.

Los binarios y modelos se guardan en `<tu-vault>/.obsidian/plugins/vibe-latex/local/`. Desde los ajustes podés iniciar o detener los servidores, y desinstalarlos por completo. La opción **Iniciar los servidores al abrir Obsidian** los levanta automáticamente cada vez que abrís la aplicación.

### Instalación manual (alternativa)

Si preferís administrar los servidores vos mismo, podés usar Ollama y cualquier servidor de transcripción compatible con la API de OpenAI.

1. Instalá [Ollama](https://ollama.com) (Windows, Mac o Linux) y descargá el modelo de conversión:

   ```bash
   ollama pull qwen3.5:9b
   ```

2. Elegí un servidor de transcripción de voz:

   a. Sin Docker: instalá las dependencias y corré el servidor incluido en el repo (funciona en Windows, Mac y Linux; la primera vez descarga el modelo de whisper):

      ```bash
      pip install faster-whisper fastapi uvicorn python-multipart
      python scripts/local_stt.py --port 8000
      ```

      El puerto es configurable con `--port` (por ejemplo, `--port 10000`); la **URL de transcripción** del plugin debe usar el mismo puerto.

   b. Con Docker: usá [Speaches](https://github.com/speaches-ai/speaches):

      ```bash
      docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu
      ```

3. En **Ajustes → Vibe LaTeX**, presioná el botón rápido **Local gratis**. Alternativamente, configurá **URL de transcripción** en `http://localhost:8000/v1` y **URL de conversión** en `http://localhost:11434/v1`, dejá la clave API vacía, usá el modelo de transcripción `Systran/faster-whisper-small` y el modelo de conversión `qwen3.5:9b`.

La calidad de conversión con modelos locales es inferior a la de OpenAI. El modelo de conversión recomendado es `qwen3.5:9b`, que entra en una GPU de 8 GB. Para transcribir se mantiene `small` de faster-whisper, con `medium` como opción para mejor precisión si tenés GPU de sobra.

## Configuración

1. Instalá y habilitá el plugin.
2. En **Ajustes → Vibe LaTeX**, ingresá tu clave de OpenAI, o presioná **Local gratis** para usar endpoints locales sin clave.
3. Permití el acceso al micrófono cuando Obsidian o el sistema lo soliciten.

Opcional: ajustá la **duración de la pausa** que separa cada frase y la
**duración máxima** de una frase. El audio se guarda con la extensión correcta
cuando activás **Guardar audio**.

## Privacidad

El audio se envía al servicio configurado para transcribirlo y el texto reconocido se envía al mismo servicio para convertirlo en Markdown y LaTeX. OpenAI se usa por defecto; la URL base permite configurar un endpoint compatible. Las grabaciones se descartan al terminar salvo que actives **Guardar audio**.

## Desarrollo

```bash
npm install
npm run build
npm test
npm run test:e2e       # requiere OPENAI_API_KEY
npm run test:obsidian  # requiere Obsidian cerrado y disponible por CDP
```

Los fixtures de audio se sintetizan con `say` en macOS. La prueba `test:e2e` comprueba la transcripción y la conversión usando el servicio configurado.
