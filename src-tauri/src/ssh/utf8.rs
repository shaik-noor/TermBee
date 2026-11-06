/// Streaming UTF-8 decoder: a multi-byte character split across two network chunks is
/// held back until the rest arrives instead of being turned into `�`.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn decode(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let mut out = String::with_capacity(self.pending.len());
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    return out;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    // SAFETY-free: the prefix up to `valid` is guaranteed UTF-8.
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match e.error_len() {
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + bad);
                        }
                        None => {
                            // Incomplete trailing sequence: keep it for the next chunk.
                            self.pending.drain(..valid);
                            return out;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8Stream;

    #[test]
    fn reassembles_split_characters() {
        let bytes = "héllo 🐝".as_bytes();
        let mut d = Utf8Stream::default();
        let mut out = String::new();
        for b in bytes {
            out.push_str(&d.decode(std::slice::from_ref(b)));
        }
        assert_eq!(out, "héllo 🐝");
    }

    #[test]
    fn replaces_invalid_bytes() {
        let mut d = Utf8Stream::default();
        assert_eq!(d.decode(&[b'a', 0xFF, b'b']), "a\u{FFFD}b");
    }
}
