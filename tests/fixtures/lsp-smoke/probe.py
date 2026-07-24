# LSP smoke fixture for the Pyright language server.
#
# Deterministic symbol `add` for definition/hover, plus one real undefined-name
# reference so Pyright publishes a diagnostic.


def add(a: int, b: int) -> int:
    return a + b


total = add(1, 2)

# Intentional undefined name -> real diagnostic from pyright.
print(undefined_name)
