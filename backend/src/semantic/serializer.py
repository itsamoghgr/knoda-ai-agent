"""Serialize SemanticModel list → dbt MetricFlow-compatible YAML."""

from typing import Any

import yaml

from models.semantic import DimensionType, SemanticModel


def to_dbt_yaml(models: list[SemanticModel]) -> str:
    """
    Render a list of SemanticModels as dbt MetricFlow YAML.

    Output format:
      semantic_models:
        - name: orders
          model: ref('orders')
          description: "..."
          entities: [...]
          dimensions: [...]
          measures: [...]
    """
    output: dict[str, Any] = {"semantic_models": []}

    for model in models:
        entry: dict[str, Any] = {
            "name": model.table_name,
            "model": f"ref('{model.table_name}')",
            "description": model.description or "",
        }

        if model.grain:
            entry["defaults"] = {"agg_time_dimension": _first_time_dim(model) or ""}

        if model.entities:
            entry["entities"] = [
                {
                    "name": e.name,
                    "type": e.entity_type.value,
                    "expr": e.column_name,
                    **({"description": e.description} if e.description else {}),
                }
                for e in model.entities
            ]

        if model.dimensions:
            dims = []
            for d in model.dimensions:
                dim_entry: dict[str, Any] = {
                    "name": d.name,
                    "type": d.dim_type.value,
                    "expr": d.column_name,
                }
                if d.description:
                    dim_entry["description"] = d.description
                if d.dim_type == DimensionType.TIME and d.time_granularity:
                    dim_entry["type_params"] = {"time_granularity": d.time_granularity}
                dims.append(dim_entry)
            entry["dimensions"] = dims

        if model.measures:
            entry["measures"] = [
                {
                    "name": m.name,
                    "agg": m.agg.value,
                    "expr": m.expr,
                    **({"description": m.description} if m.description else {}),
                }
                for m in model.measures
            ]

        output["semantic_models"].append(entry)

    return yaml.dump(output, sort_keys=False, allow_unicode=True, default_flow_style=False)


def _first_time_dim(model: SemanticModel) -> str | None:
    for d in model.dimensions:
        if d.dim_type == DimensionType.TIME:
            return d.name
    return None
