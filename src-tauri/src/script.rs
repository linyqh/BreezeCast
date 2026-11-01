use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ParsedLine {
    pub speaker: String,
    pub text: String,
    pub direction: String,
    pub pause_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct ParsedScript {
    pub speakers: Vec<String>,
    pub lines: Vec<ParsedLine>,
}

const DEFAULT_PAUSE: u64 = 400;

fn parse_pause(line: &str) -> Option<u64> {
    let inner = line.strip_prefix('<')?.strip_suffix('>')?.trim();
    let rest = inner.strip_prefix("pause")?.trim().to_ascii_lowercase();
    if let Some(ms) = rest.strip_suffix("ms") {
        return ms.trim().parse::<f64>().ok().map(|v| v.max(0.0) as u64);
    }
    let secs = rest.strip_suffix('s').unwrap_or(&rest);
    secs.trim().parse::<f64>().ok().map(|v| (v.max(0.0) * 1000.0) as u64)
}

/// `Speaker {direction}: text`. The speaker part must be short and free of sentence punctuation
/// so that ordinary sentences containing a colon are not mistaken for speaker turns.
fn parse_turn(line: &str) -> Option<(String, String, String)> {
    let idx = line.char_indices().find(|(_, c)| *c == ':' || *c == '：').map(|(i, _)| i)?;
    let head = line[..idx].trim();
    let colon_len = line[idx..].chars().next()?.len_utf8();
    let text = line[idx + colon_len..].trim().to_string();
    let (name, direction) = match (head.find('{'), head.rfind('}')) {
        (Some(a), Some(b)) if b > a => (head[..a].trim(), head[a + 1..b].trim().to_string()),
        _ => (head, String::new()),
    };
    let name = name.trim_start_matches(['-', '*', '#', ' ']).trim();
    if name.is_empty() || name.chars().count() > 24 || name.contains(['。', '，', ',', '.', '!', '?', '！', '？', '(', '[']) {
        return None;
    }
    Some((name.to_string(), direction, text))
}

pub fn parse(script: &str) -> ParsedScript {
    let mut lines: Vec<ParsedLine> = Vec::new();
    let mut speakers: Vec<String> = Vec::new();
    for raw in script.lines() {
        let l = raw.trim();
        if l.is_empty() || l.starts_with("# ") || l == "#" {
            continue;
        }
        if let Some(p) = parse_pause(l) {
            if let Some(last) = lines.last_mut() {
                last.pause_ms = p;
            }
            continue;
        }
        if let Some((speaker, direction, text)) = parse_turn(l) {
            if !speakers.contains(&speaker) {
                speakers.push(speaker.clone());
            }
            lines.push(ParsedLine { speaker, text, direction, pause_ms: DEFAULT_PAUSE });
        } else if let Some(last) = lines.last_mut() {
            if !last.text.is_empty() {
                last.text.push(' ');
            }
            last.text.push_str(l);
        } else {
            let speaker = "Narrator".to_string();
            speakers.push(speaker.clone());
            lines.push(ParsedLine { speaker, text: l.to_string(), direction: String::new(), pause_ms: DEFAULT_PAUSE });
        }
    }
    lines.retain(|l| !l.text.is_empty());
    ParsedScript { speakers, lines }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_turns_directions_pauses_and_continuations() {
        let s = parse(
            "# 标题\n主持人: [笑] 欢迎收听。\n嘉宾 {轻声，犹豫}：嗯……其实\n我也不确定。\n<pause 1.5s>\nHost {excited}: (laugh) Wow: really?\n<pause 200ms>",
        );
        assert_eq!(s.speakers, vec!["主持人", "嘉宾", "Host"]);
        assert_eq!(s.lines.len(), 3);
        assert_eq!(s.lines[1].direction, "轻声，犹豫");
        assert_eq!(s.lines[1].text, "嗯……其实 我也不确定。");
        assert_eq!(s.lines[1].pause_ms, 1500);
        assert_eq!(s.lines[2].text, "(laugh) Wow: really?");
        assert_eq!(s.lines[2].pause_ms, 200);
    }

    #[test]
    fn sentence_with_colon_is_not_a_speaker() {
        let s = parse("A: 第一句。\n他说了一句话，原因是：太晚了。");
        assert_eq!(s.lines.len(), 1);
        assert!(s.lines[0].text.ends_with("原因是：太晚了。"));
    }
}
