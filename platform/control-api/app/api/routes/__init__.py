"""Connect|API Platform HTTP route package.

The package intentionally does not eagerly import every historical RC34 module.
`app.main` imports only the canonical Connect|API routes. Optional reference
modules may still be imported explicitly when a compatibility flag is enabled.
"""

__all__: list[str] = []
