from django.urls import path
from . import views

urlpatterns = [
    path("quizzes/", views.StudentQuizListView.as_view(), name="student-quizzes"),
    path("quizzes/<uuid:quiz_id>/attempts/", views.StudentStartAttemptView.as_view(), name="student-quiz-start"),
    path("quiz-attempts/<uuid:attempt_id>/submit/", views.StudentSubmitAttemptView.as_view(), name="student-quiz-submit"),
    path("quiz-attempts/<uuid:attempt_id>/", views.StudentAttemptView.as_view(), name="student-quiz-attempt"),
    path("scores/", views.StudentScoresView.as_view(), name="student-scores"),
]
