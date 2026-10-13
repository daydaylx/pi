# LSP smoke fixture for the Pyright language server.
#
# One real undefined-name reference so Pyright publishes a diagnostic.


def add(a: int, b: int) -> int:
    return a + b


total = add(1, 2)

# Intentional undefined name -> real diagnostic from pyright.
print(undefined_name)
