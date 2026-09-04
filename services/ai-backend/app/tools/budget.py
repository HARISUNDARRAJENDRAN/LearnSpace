from dataclasses import dataclass, field


class ToolBudgetExceeded(RuntimeError):
    pass


def empty_call_counts() -> dict[str, int]:
    return {}


@dataclass
class ToolBudget:
    limit: int
    used: int = 0
    primary_reserved: int = 0
    optional_phase: bool = False
    call_counts: dict[str, int] = field(default_factory=empty_call_counts)

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)

    def reserve_primary(self, count: int) -> None:
        self.primary_reserved = min(max(0, count), self.limit)

    def release_primary(self, count: int = 1) -> None:
        self.primary_reserved = max(0, self.primary_reserved - max(0, count))

    def begin_optional_phase(self) -> None:
        self.optional_phase = True
        self.primary_reserved = 0

    def consume(self, tool_name: str, *, optional: bool = False) -> None:
        if optional and not self.optional_phase and self.remaining <= self.primary_reserved:
            raise ToolBudgetExceeded(f"optional discovery tool deferred before {tool_name}")
        if self.used >= self.limit:
            raise ToolBudgetExceeded(f"discovery tool budget exhausted before {tool_name}")
        self.used += 1
        self.call_counts[tool_name] = self.call_counts.get(tool_name, 0) + 1
        if not optional and self.primary_reserved > 0:
            self.primary_reserved -= 1
