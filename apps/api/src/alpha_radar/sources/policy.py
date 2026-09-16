from dataclasses import dataclass

from alpha_radar.sources.schemas import LicenseClass


@dataclass(frozen=True)
class StoragePolicy:
    metadata: bool
    excerpt: bool
    full_content: bool = False


def storage_policy(license_class: LicenseClass) -> StoragePolicy:
    # A license classification alone never authorizes a full-content archive.
    return StoragePolicy(
        metadata=license_class != "restricted",
        excerpt=license_class in {"public_official", "excerpt_allowed", "licensed"},
    )
