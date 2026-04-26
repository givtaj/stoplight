use stoplight_core::{
    ContinueBuildInput, DecodeBodyInput, NormalizeRequestInput, RequestDiff, SessionEvent,
    SessionState, build_continue_payload as build_continue_payload_core,
    compute_diff as compute_diff_core, decode_body as decode_body_core,
    normalize_request as normalize_request_core, reduce_session_event as reduce_session_event_core,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn normalize_request(input: JsValue) -> Result<JsValue, JsValue> {
    let input: NormalizeRequestInput = from_js(input)?;
    to_js(&normalize_request_core(input))
}

#[wasm_bindgen]
pub fn decode_body(input: JsValue) -> Result<JsValue, JsValue> {
    let input: DecodeBodyInput = from_js(input)?;
    to_js(&decode_body_core(input))
}

#[wasm_bindgen]
pub fn build_continue_payload(input: JsValue) -> Result<JsValue, JsValue> {
    let input: ContinueBuildInput = from_js(input)?;
    let payload = build_continue_payload_core(input).map_err(|error| JsValue::from_str(&error))?;
    to_js(&payload)
}

#[wasm_bindgen]
pub fn compute_diff(input: JsValue) -> Result<JsValue, JsValue> {
    let input = from_js(input)?;
    let diff: RequestDiff = compute_diff_core(input);
    to_js(&diff)
}

#[wasm_bindgen]
pub fn reduce_session_event(state: JsValue, event: JsValue) -> Result<JsValue, JsValue> {
    let state: SessionState = from_js(state)?;
    let event: SessionEvent = from_js(event)?;
    to_js(&reduce_session_event_core(state, event))
}

fn from_js<T>(value: JsValue) -> Result<T, JsValue>
where
    T: serde::de::DeserializeOwned,
{
    serde_wasm_bindgen::from_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn to_js<T>(value: &T) -> Result<JsValue, JsValue>
where
    T: serde::Serialize,
{
    serde_wasm_bindgen::to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}
