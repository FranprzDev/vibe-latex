# Changelog

Todos los cambios relevantes de Vibe LaTeX se documentan acá. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado es
[SemVer](https://semver.org/lang/es/).

## [0.4.1] - 2026-11-12

### Agregado
- `scripts/local_stt.py` acepta `--port` para elegir el puerto.

### Cambiado
- El botón **Local gratis** y la guía usan `qwen3.5:9b` como modelo de conversión recomendado.

## [0.4.0] - 2026-11-12

### Agregado
- URLs base separadas para transcripción y conversión.
- La clave API es opcional al usar endpoints locales compatibles con OpenAI.
- Botones de **Configuración rápida** ("OpenAI" y "Local gratis") en los ajustes.
- Sección de modo local gratis, sin OpenAI, en el README.
- Script `scripts/local_stt.py` para transcribir en local sin Docker.
- Sección de instalación con BRAT en el README.

### Cambiado
- Los tags de release van sin prefijo `v` (requisito del listado oficial de Obsidian).

## [0.3.0] - 2026-10-03

### Agregado
- Ajustes de dictado: duración de la pausa y duración máxima de la frase.
- Helper `anySignal` compatible con Obsidian 1.5 (sin `AbortSignal.any`).
- Suite de tests para `anySignal`, propagación de cancelación, temporizados y
  smoke test del ciclo de vida del plugin.
- `CHANGELOG.md` y `CONTRIBUTING.md`.

### Cambiado
- El `AbortSignal` de la sesión ahora se propaga por el pipeline hasta las
  llamadas HTTP: detener el dictado cancela la request en curso.
- El audio guardado usa la extensión acorde al contenedor real (webm/m4a/ogg/…).

### Corregido
- Compatibilidad con Obsidian 1.5 al no depender de `AbortSignal.any`.
- El ajuste de carpeta sin `Guardar audio` ya no crea archivos con extensión
  incorrecta.

## [0.2.0] - 2026-10-03

### Agregado
- Comando **Corregir la última frase dictada** (`Cmd/Ctrl+Shift+R`).
- Persistencia de la última frase para corregir tras reiniciar Obsidian.
- Migración de ajustes: se descarta `language` y se actualizan los prompts
  default heredados sin pisar los personalizados.

### Cambiado
- El plugin dicta **solo en español**, con un prompt que conserva todos los
  pasos narrados.
- Los errores se muestran en español; se rechaza una conversión vacía.

## [0.1.1] - 2026-10-01

### Cambiado
- Branding a **Vibe LaTeX** conservando el ID del plugin para no romper
  instalaciones existentes.

## [0.1.0] - 2026-10-01

### Agregado
- Versión inicial: dictado continuo con segmentación por silencios, conversión
  a Markdown + LaTeX, proveedor OpenAI configurable y seguimiento de uso.
