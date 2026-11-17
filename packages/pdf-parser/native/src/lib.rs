use napi::bindgen_prelude::*;
use napi_derive::napi;
use pdf_inspector::{
    extract_pages_markdown_mem, extract_structure_elements_mem,
    extract_text_with_positions_mem, process_pdf_mem, process_research_pdf_mem,
};
use std::time::Instant;

#[napi(object)]
pub struct ParseResult {
    pub markdown: Option<String>,
    pub pages: Vec<Page>,
    pub text_items: Vec<TextItem>,
    pub structure: Vec<StructureElement>,
    pub pdf_type: String,
    pub page_count: u32,
    pub confidence: f64,
    pub pages_needing_ocr: Vec<u32>,
    pub ocr_reasons_by_page: Vec<OcrReason>,
    pub title: Option<String>,
    pub has_encoding_issues: bool,
    pub is_complex_layout: bool,
    pub processing_time_ms: u32,
}

#[napi(object)]
pub struct Page {
    pub page: u32,
    pub markdown: String,
    pub needs_ocr: bool,
    pub ocr_reason: Option<String>,
}

#[napi(object)]
pub struct TextItem {
    pub text: String,
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub font: String,
    pub font_size: f64,
    pub bold: bool,
    pub italic: bool,
}

#[napi(object)]
pub struct StructureElement {
    pub page: u32,
    pub mcid: i64,
    pub role: String,
}

#[napi(object)]
pub struct OcrReason {
    pub page: u32,
    pub reasons: Vec<String>,
}

#[napi]
pub fn parse(buffer: Buffer, trusted_research: bool, max_pages: u32) -> Result<ParseResult> {
    let bytes = buffer.to_vec();
    let started = Instant::now();
    let document = lopdf::Document::load_mem(&bytes)
        .map_err(|error| Error::from_reason(format!("invalid PDF: {error}")))?;
    let page_count = document.get_pages().len() as u32;
    enforce_page_limit(page_count, max_pages)?;
    let result = if trusted_research {
        process_research_pdf_mem(&bytes)
    } else {
        process_pdf_mem(&bytes)
    }
    .map_err(|error| Error::from_reason(error.to_string()))?;
    let page_output = extract_pages_markdown_mem(&bytes, None)
        .map_err(|error| Error::from_reason(error.to_string()))?;
    let text_items = extract_text_with_positions_mem(&bytes)
        .map_err(|error| Error::from_reason(error.to_string()))?
        .into_iter()
        .map(|item| TextItem {
            text: item.text,
            page: item.page,
            x: item.x.into(),
            y: item.y.into(),
            width: item.width.into(),
            height: item.height.into(),
            font: item.font,
            font_size: item.font_size.into(),
            bold: item.is_bold,
            italic: item.is_italic,
        })
        .collect();
    let structure = extract_structure_elements_mem(&bytes, None)
        .map_err(|error| Error::from_reason(error.to_string()))?
        .into_iter()
        .map(|element| StructureElement {
            page: element.page,
            mcid: element.mcid,
            role: element.role,
        })
        .collect();
    Ok(ParseResult {
        markdown: result.markdown,
        pages: page_output.pages.into_iter().map(|page| Page {
            page: page.page + 1,
            markdown: page.markdown,
            needs_ocr: page.needs_ocr,
            ocr_reason: page.ocr_reason,
        }).collect(),
        text_items,
        structure,
        pdf_type: format!("{:?}", result.pdf_type),
        page_count: result.page_count,
        confidence: result.confidence.into(),
        pages_needing_ocr: result.pages_needing_ocr,
        ocr_reasons_by_page: result.ocr_reasons_by_page.into_iter().map(|reason| OcrReason {
            page: reason.page,
            reasons: reason.reasons,
        }).collect(),
        title: result.title,
        has_encoding_issues: result.has_encoding_issues,
        is_complex_layout: result.layout.is_complex,
        processing_time_ms: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
    })
}


fn enforce_page_limit(page_count: u32, max_pages: u32) -> Result<()> {
    if page_count > max_pages {
        Err(Error::from_reason(format!("PDF exceeds maximum of {max_pages} pages")))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::enforce_page_limit;

    #[test]
    fn page_limit_rejects_oversized_documents() {
        assert!(enforce_page_limit(300, 300).is_ok());
        assert!(enforce_page_limit(301, 300).is_err());
    }
}
