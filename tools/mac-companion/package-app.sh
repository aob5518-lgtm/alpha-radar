#!/bin/bash
set -euo pipefail

package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
output_dir="${1:-${package_dir}/.build}"
app="${output_dir}/Alpha Radar Mac Executor.app"
if [[ -e "${app}" || -L "${app}" ]]; then
    printf 'App already exists at %s. Choose another output directory.\n' "${app}" >&2
    exit 1
fi

swift build --package-path "${package_dir}" --configuration release --product AlphaRadarMac
binary_dir="$(swift build --package-path "${package_dir}" --configuration release --show-bin-path)"
mkdir -p "${app}/Contents/MacOS"
install -m 755 "${binary_dir}/AlphaRadarMac" "${app}/Contents/MacOS/AlphaRadarMac"
install -m 644 "${package_dir}/Info.plist" "${app}/Contents/Info.plist"
codesign --force --sign - "${app}"
codesign --verify --strict "${app}"
printf '%s\n' "${app}"
