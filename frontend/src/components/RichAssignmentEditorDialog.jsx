import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

function RichAssignmentEditorDialog({ open, value, onChange, onClose, onSave }) {
  const editorRef = useRef(null);
  const selectedImageRef = useRef(null);
  const [selectedImageWidth, setSelectedImageWidth] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (editorRef.current) {
      editorRef.current.innerHTML = value || "";
      selectedImageRef.current = null;
      setSelectedImageWidth(0);
    }
  }, [open]);

  const syncHtml = () => {
    if (!editorRef.current) return;
    onChange?.(editorRef.current.innerHTML);
  };

  const runCommand = (command, arg = null) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, arg);
    syncHtml();
  };

  const handleInput = () => {
    syncHtml();
  };

  const handlePaste = async (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;

    event.preventDefault();
    for (const file of imageFiles) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      runCommand("insertImage", String(dataUrl));
    }
  };

  const handleEditorClick = (event) => {
    const target = event.target;
    if (target?.tagName === "IMG") {
      selectedImageRef.current = target;
      const width = Math.round(target.getBoundingClientRect().width || 0);
      setSelectedImageWidth(width);
      return;
    }
    selectedImageRef.current = null;
    setSelectedImageWidth(0);
  };

  const applyImageWidth = (width) => {
    const img = selectedImageRef.current;
    if (!img) return;
    const safeWidth = Math.max(80, Math.min(1200, Number(width || 0)));
    img.style.width = `${safeWidth}px`;
    img.style.height = "auto";
    img.style.maxWidth = "100%";
    setSelectedImageWidth(safeWidth);
    syncHtml();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Assignment Content Editor</DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap" }}>
          <Tooltip title="Bold"><Button size="small" variant="outlined" onClick={() => runCommand("bold")}>B</Button></Tooltip>
          <Tooltip title="Italic"><Button size="small" variant="outlined" onClick={() => runCommand("italic")}>I</Button></Tooltip>
          <Tooltip title="Underline"><Button size="small" variant="outlined" onClick={() => runCommand("underline")}>U</Button></Tooltip>
          <Tooltip title="Undo"><Button size="small" variant="outlined" onClick={() => runCommand("undo")}>Undo</Button></Tooltip>
          <Tooltip title="Redo"><Button size="small" variant="outlined" onClick={() => runCommand("redo")}>Redo</Button></Tooltip>
          <Tooltip title="Heading"><Button size="small" variant="outlined" onClick={() => runCommand("formatBlock", "H2")}>H2</Button></Tooltip>
          <Tooltip title="Paragraph"><Button size="small" variant="outlined" onClick={() => runCommand("formatBlock", "P")}>P</Button></Tooltip>
          <Tooltip title="Bulleted List"><Button size="small" variant="outlined" onClick={() => runCommand("insertUnorderedList")}>Bullets</Button></Tooltip>
          <Tooltip title="Numbered List"><Button size="small" variant="outlined" onClick={() => runCommand("insertOrderedList")}>Numbers</Button></Tooltip>
          <Tooltip title="Align Left"><Button size="small" variant="outlined" onClick={() => runCommand("justifyLeft")}>Left</Button></Tooltip>
          <Tooltip title="Align Center"><Button size="small" variant="outlined" onClick={() => runCommand("justifyCenter")}>Center</Button></Tooltip>
          <Tooltip title="Align Right"><Button size="small" variant="outlined" onClick={() => runCommand("justifyRight")}>Right</Button></Tooltip>
          <Tooltip title="Insert Link"><Button size="small" variant="outlined" onClick={() => {
            const url = window.prompt("Enter link URL");
            if (url) runCommand("createLink", url);
          }}>Link</Button></Tooltip>
          <Tooltip title="Remove Formatting"><Button size="small" variant="outlined" onClick={() => runCommand("removeFormat")}>Clear</Button></Tooltip>
        </Stack>
        {selectedImageRef.current && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ minWidth: 84 }}>Image Width</Typography>
            <Box sx={{ width: 220, px: 1 }}>
              <Slider
                min={80}
                max={1200}
                step={10}
                value={Math.max(80, selectedImageWidth || 80)}
                onChange={(_, val) => applyImageWidth(Array.isArray(val) ? val[0] : val)}
              />
            </Box>
            <TextField
              size="small"
              type="number"
              value={selectedImageWidth || 0}
              onChange={(e) => applyImageWidth(Number(e.target.value || 0))}
              sx={{ width: 110 }}
              inputProps={{ min: 80, max: 1200, step: 10 }}
            />
            <Button size="small" variant="outlined" onClick={() => applyImageWidth(320)}>Small</Button>
            <Button size="small" variant="outlined" onClick={() => applyImageWidth(640)}>Medium</Button>
            <Button size="small" variant="outlined" onClick={() => applyImageWidth(960)}>Large</Button>
          </Stack>
        )}
        <Divider sx={{ mb: 1.5 }} />
        <Box
          ref={editorRef}
          contentEditable
          dir="ltr"
          spellCheck
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={handlePaste}
          onClick={handleEditorClick}
          sx={{
            minHeight: 320,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            p: 1.5,
            overflowY: "auto",
            backgroundColor: "#fff",
            textAlign: "left",
            direction: "ltr",
            unicodeBidi: "plaintext",
            "& img": {
              maxWidth: "100%",
              height: "auto",
              cursor: "pointer",
              borderRadius: 0.5,
            },
            "& img:hover": {
              outline: "2px solid #90caf9",
            },
            "&:focus": { outline: "2px solid #1976d2", outlineOffset: 1 },
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          You can write formatted content, paste text/images directly, click an image to resize it.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={onSave}>Use This Content</Button>
      </DialogActions>
    </Dialog>
  );
}

export default RichAssignmentEditorDialog;
