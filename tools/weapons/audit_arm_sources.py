"""Read-only validation of an explicit list of Blender arm sources."""
import argparse
import json
from pathlib import Path
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from arm_contract import load_contract, validate_arms


ROOT = Path(__file__).resolve().parent.parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--files', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    names = json.loads(Path(args.files).read_text(encoding='utf8'))
    assert names and len(names) == len(set(names))
    contract, _ = load_contract()
    for name in names:
        source = (ROOT / name).resolve()
        assert ROOT in source.parents and source.suffix == '.blend' and source.is_file(), name
        bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
        validate_arms(contract)
    print(json.dumps({'validated': len(names), 'contract': contract['version']}))


if __name__ == '__main__':
    main()
