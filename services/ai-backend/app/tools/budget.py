from dataclasses import dataclass


class ToolBudgetExceeded(RuntimeError):
    pass


@dataclass
class ToolBudget:
    limit: int
    used: int = 0

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)

    def consume(self, tool_name: str) -> None:
        if self.used >= self.limit:
            raise ToolBudgetExceeded(f"discovery tool budget exhausted before {tool_name}")
        self.used += 1
