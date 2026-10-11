// Concern: the experimental WebUSB transport: a model's `control` setup steps, each sent when called | Non-concern: what a step holds (the core), MIDI, HID | IO: (step) -> control transfers
//! A vendor request to the device needs no claimed interface (docs/research/flx10-browser.md
//! "WebUSB control transfers"); the OS must still let the browser open the device.

use dj_controller_core::hid::{Setup, Via};
use dj_controller_core::model::Model;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    UsbControlTransferParameters, UsbDevice, UsbDeviceFilter, UsbDeviceRequestOptions, UsbOutTransferResult,
    UsbRecipient, UsbRequestType, UsbTransferStatus,
};

use crate::js::text as js_text;

/// From a click: chooses and opens the device, sends step `name`'s transfers, closes it; resolves
/// to how many went.
#[wasm_bindgen(js_name = controlStep, skip_typescript)]
pub async fn control_step(model: String, name: String) -> Result<u32, JsError> {
    let model = Model::named(&model).ok_or_else(|| JsError::new(&format!("no model {model:?}")))?;
    let step = model.hid.as_ref().and_then(|h| h.step(&name)).filter(|s| s.via == Via::Control);
    let step = step.ok_or_else(|| JsError::new(&format!("{} has no control step {name:?}", model.name)))?;
    let navigator = web_sys::window().ok_or_else(|| JsError::new("no window"))?.navigator();
    if !js_sys::Reflect::has(&navigator, &"usb".into()).unwrap_or(false) {
        return Err(JsError::new("this browser has no WebUSB"));
    }
    let filter = UsbDeviceFilter::new();
    filter.set_vendor_id(model.usb_vendor);
    filter.set_product_id(model.usb_product);
    let chosen = JsFuture::from(navigator.usb().request_device(&UsbDeviceRequestOptions::new(&[filter])))
        .await
        .map_err(|e| JsError::new(&js_text(&e)))?;
    let device: UsbDevice = chosen.unchecked_into();
    JsFuture::from(device.open())
        .await
        .map_err(|e| JsError::new(&format!("the system did not let the browser open the device: {}", js_text(&e))))?;
    let mut sent = 0;
    let mut result = Ok(());
    for packet in &step.messages {
        result = transfer(&device, Setup::of(packet)).await;
        if result.is_err() {
            break;
        }
        sent += 1;
    }
    let _ = JsFuture::from(device.close()).await;
    result.map(|()| sent).map_err(|e| JsError::new(&format!("{name}: transfer {}: {e}", sent + 1)))
}

/// bmRequestType bits 6..5 and 4..0 as USB 2.0 table 9-2 assigns them.
async fn transfer(device: &UsbDevice, setup: Setup) -> Result<(), String> {
    let request_type = match setup.request_type >> 5 & 3 {
        0 => UsbRequestType::Standard,
        1 => UsbRequestType::Class,
        2 => UsbRequestType::Vendor,
        _ => return Err(format!("bmRequestType {:02X}: reserved type", setup.request_type)),
    };
    let recipient = match setup.request_type & 0x1F {
        0 => UsbRecipient::Device,
        1 => UsbRecipient::Interface,
        2 => UsbRecipient::Endpoint,
        3 => UsbRecipient::Other,
        _ => return Err(format!("bmRequestType {:02X}: reserved recipient", setup.request_type)),
    };
    let parameters =
        UsbControlTransferParameters::new(setup.index, recipient, setup.request, request_type, setup.value);
    let sent = JsFuture::from(device.control_transfer_out(&parameters)).await.map_err(|e| js_text(&e))?;
    match sent.unchecked_into::<UsbOutTransferResult>().status() {
        UsbTransferStatus::Ok => Ok(()),
        status => Err(format!("{status:?}")),
    }
}
