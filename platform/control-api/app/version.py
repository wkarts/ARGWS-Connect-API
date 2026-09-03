from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def get_app_version() -> str:
    """Retorna a versão canônica da aplicação sem duplicá-la no código.

    Prioridade:
    1. APP_VERSION do ambiente, quando preenchida pelo bootstrap/deploy;
    2. primeiro arquivo VERSION encontrado subindo a árvore da aplicação;
    3. VERSION do diretório de execução;
    4. valor neutro ``dev`` como último fallback.
    """
    env_version = os.getenv("APP_VERSION", "").strip()
    if env_version and env_version.lower() not in {"auto", "__auto_from_version__"}:
        return env_version

    current = Path(__file__).resolve()
    candidates = [parent / "VERSION" for parent in current.parents]
    candidates.extend((Path.cwd() / "VERSION", Path.cwd().parent / "VERSION"))

    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            value = candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return value

    return "dev"
