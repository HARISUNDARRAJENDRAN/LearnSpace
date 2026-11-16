use pdf_inspector::{process_pdf_mem, PdfProcessResult};
use std::{env, fs, time::Instant};

const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(FNV_OFFSET, |value, byte| (value ^ u64::from(*byte)).wrapping_mul(FNV_PRIME))
}

fn main() {
    let mut args = env::args().skip(1);
    let mode = args.next().expect("mode");
    let path = args.next().expect("pdf path");
    let markdown_output = args.next();
    let bytes = fs::read(&path).expect("read pdf");
    let started = Instant::now();
    let result: Result<PdfProcessResult, _> = if mode == "research" {
        #[cfg(feature = "research")]
        { pdf_inspector::process_research_pdf_mem(&bytes) }
        #[cfg(not(feature = "research"))]
        { panic!("research mode is unavailable in this build"); }
    } else {
        process_pdf_mem(&bytes)
    };
    match result {
        Ok(result) => {
            let markdown = result.markdown.unwrap_or_default();
            if let Some(path) = markdown_output {
                fs::write(path, markdown.as_bytes()).expect("write markdown output");
            }
            println!("{}\t{}\t{}\t{}\t{}\t{}", started.elapsed().as_nanos(), hash(markdown.as_bytes()), markdown.len(), result.page_count, format!("{:?}", result.pdf_type), result.pages_needing_ocr.len());
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}
