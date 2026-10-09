#!/bin/sh
set -eu

source_dir=${1:?source directory required}
build_dir=${2:?build directory required}

# Runtime CPU dispatch includes a baseline plus SIMD variants on x86. The
# upstream feature score selects only instruction sets supported by the host.
# ARMv8-a/NEON is the portable ARM baseline for Debian Bookworm's GCC 12.
if [ "$(uname -m)" = aarch64 ] || [ "$(uname -m)" = arm64 ]; then
  arm_option='-DGGML_CPU_ARM_ARCH=armv8-a'
  runtime_variants=OFF
else
  arm_option=''
  runtime_variants=ON
fi

cmake -S "$source_dir" -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS=-DCPPHTTPLIB_THREAD_POOL_COUNT=2 \
  -DBUILD_SHARED_LIBS=ON \
  -DCMAKE_LIBRARY_OUTPUT_DIRECTORY="$build_dir/bin" \
  -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
  '-DCMAKE_INSTALL_RPATH=$ORIGIN' \
  -DGGML_BACKEND_DL="$runtime_variants" \
  -DGGML_CPU_ALL_VARIANTS="$runtime_variants" \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DGGML_BLAS=OFF \
  -DGGML_CUDA=OFF \
  -DGGML_VULKAN=OFF \
  -DGGML_SSE42=OFF \
  -DGGML_AVX=OFF \
  -DGGML_AVX2=OFF \
  -DGGML_AVX_VNNI=OFF \
  -DGGML_FMA=OFF \
  -DGGML_F16C=OFF \
  -DGGML_BMI2=OFF \
  -DGGML_AVX512=OFF \
  $arm_option

# CPU variant libraries are not dependencies of whisper-server when dynamically
# loaded, so build the default target before collecting the runtime artifacts.
cmake --build "$build_dir" --config Release -j "${SPEECH_BUILD_JOBS:-2}"
"$build_dir/bin/whisper-server" --help >/dev/null 2>&1
