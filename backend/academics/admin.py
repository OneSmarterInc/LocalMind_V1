from django.contrib import admin
from .models import Enrollment, FacultySubject, Subject

admin.site.register(Subject)
admin.site.register(FacultySubject)
admin.site.register(Enrollment)
