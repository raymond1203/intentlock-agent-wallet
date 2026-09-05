# Dataset versioning

Benchmark versions use semantic `major.minor.patch` numbers.

- Major: schema meaning, label definition, or oracle semantics change.
- Minor: new scenarios or mutation operators without changing existing meanings.
- Patch: typo or metadata correction that cannot alter a decision or split.

Generated scenario files are immutable within a version. Edit the generator or source template, bump the
dataset version, regenerate, and record the PR in `benchmark/splits/manifest.json`. Raw result directories
must include the dataset version, code commit, model config, fork fingerprint, and seed.

Hidden-test contamination always requires at least a minor bump. Deleting a difficult scenario or changing a
label after seeing evaluation results requires a written adjudication and rerunning all baselines.
