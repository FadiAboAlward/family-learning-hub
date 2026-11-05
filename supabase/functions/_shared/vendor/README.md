`webp_dec.wasm` is copied without modification from
`@jsquash/webp@1.5.0/codec/dec/webp_dec.wasm`.
The exact npm package is pinned by the adjacent package-lock.json; its Apache
license and the codec's upstream license are included here. The visual unit test
compares the vendored bytes with that locked package before decoding real WebP.

The Edge functions that author media must bundle this file through their existing
`static_files` configuration. No decoder download occurs during a learner request.
