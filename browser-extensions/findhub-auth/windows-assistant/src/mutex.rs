// Same per-session installation mutex as the existing NSIS setup. Never coordinate through browser files.
#[cfg(windows)]
mod native {
    use std::{ffi::c_void, io, ptr::null_mut};
    type Handle = *mut c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: Handle, owner: i32, name: *const u16) -> Handle;
        fn GetLastError() -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    pub struct InstallationMutex(Handle);
    impl InstallationMutex {
        pub fn acquire() -> io::Result<Self> {
            let name: Vec<u16> = "Local\\ARGWS.FindHubAuth.Setup"
                .encode_utf16()
                .chain(Some(0))
                .collect();
            unsafe {
                let handle = CreateMutexW(null_mut(), 0, name.as_ptr());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }
                if GetLastError() == 183 {
                    CloseHandle(handle);
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "Outro instalador/assistente já está aberto. Feche-o antes de continuar.",
                    ));
                }
                Ok(Self(handle))
            }
        }
    }
    impl Drop for InstallationMutex {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}
#[cfg(windows)]
pub use native::InstallationMutex;
