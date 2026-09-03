from app.workers.celery_app import celery_app


def test_celery_remote_control_is_disabled_for_rabbitmq4() -> None:
    assert celery_app.conf.worker_enable_remote_control is False


def test_long_running_tasks_are_cancelled_on_connection_loss() -> None:
    assert celery_app.conf.worker_cancel_long_running_tasks_on_connection_loss is True
