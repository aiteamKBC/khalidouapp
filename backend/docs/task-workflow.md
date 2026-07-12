# Task workflow and review permissions

This document defines the task states that employees can work on and the review boundary between a Team Manager and a General Admin.

## Working states

| Stage | Meaning | Available in the employee task picker | Time tracking |
| --- | --- | --- | --- |
| `new_requests` | An employee-created task waiting for approval | No | No |
| `backlog` | Approved work that has not started | Yes | Yes |
| `assigned` | Work assigned to the team | Yes | Yes |
| `in_progress` | Work currently being performed | Yes | Yes |
| `ready_for_review` | The assignee submitted the task as finished | No | No |
| `blocked` | Work paused because of a documented obstacle | No | No |
| `completed` | Completion was approved | No | No |
| `rejected` | A proposed task was rejected | No | No |
| `cancelled` | The task was intentionally closed without completion | No | No |

Employees may select any trackable task in one of their active teams, even when another employee is the primary assignee. Only the primary assignee may change the task stage or submit it for completion review.

## Review flow

1. The primary assignee submits an active task as finished.
2. The task moves to `ready_for_review`, active tracking stops, and a pending completion request is created.
3. Eligible reviewers receive an actionable notification.
4. A reviewer either approves the request, which moves the task to `completed`, or returns it with a required note to `backlog`, `assigned`, `in_progress`, or `blocked`.
5. A request can be decided only once. Later decisions are rejected as stale.

Employee-created tasks use the same approval record. They remain in `new_requests` until a reviewer approves them into an active state or rejects the proposal.

## Permissions

| Capability | Employee | Team Manager | General Admin |
| --- | --- | --- | --- |
| View/select trackable tasks | Active teams | Owned teams | All company teams |
| Change a task's working stage | Own assigned task | Owned teams | All company teams |
| Review a task request | No | Owned teams, except own task | All company teams |
| Manage team membership/ownership | No | No | Yes |
| Manage admin roles, invitations and company settings | No | No | Yes |

A Team Manager can also have an employee profile and receive tasks. The linked employee identity is used to prevent the manager from approving or returning their own task. That request remains available to another manager for the team and to the General Admin.

## Why `blocked` remains

`blocked` is not a closed outcome. It records that work cannot continue because of an external dependency or obstacle. A reason is required, current tracking is stopped immediately, and reviewers are notified. Returning it to work requires a resolution note, so the blocker and its resolution remain auditable. This makes it materially different from `cancelled`, `rejected`, or `completed`.
